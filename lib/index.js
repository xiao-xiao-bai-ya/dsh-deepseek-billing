/**
 * @dsh-external/dsh-deepseek-billing — Host half
 * DeepSeek Harness 余额悬浮窗（实时计量版）：
 *  - 当前余额（官方接口轮询 + 手动刷新）
 *  - 本轮已花费：llm/stream 实时按 token 计价，边生成边跳动
 *  - 上轮花费：一轮结束后保留上一轮费用
 *  - 对话框开始余额：按 sessionId 持久化到 ~/.dsh/storages/deepseek-billing.json
 *  - 用量明细：每轮（一次提问→回答结束）聚合一条记录（时间/提问/模型/产品端/花费）持久化，
 *    HTTP 路由按时间段查询，悬浮窗「更多」按钮展开明细视图
 *  - WebSocket 实时推送快照 + HTTP 快照路由 + 模型工具 deepseek_billing
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WebSocketServer } from 'ws'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { rename as nodeRename } from 'node:fs/promises'
import z from '@deepseek-ai/schemastery'

// ABI 守卫（craft §5 / findings "craft 手法对账" #5）：宿主符号漂移则加载时大声失败，
// 避免运行到一半才在 agent-loop 调度时炸（参考 chat-import 的 TOOL_RUNTIME_SCHEDULER 检查 + 你
// 的 dsh-prepare-crash-guide 同源事故）。本插件守护的 DSH 导出 = defineTool + dshHomePath；
// 'ws' 是三方库不在 DSH ABI 范畴，不守。
if (typeof defineTool !== 'function') throw new Error('dsh-deepseek-billing: @deepseek-ai/dsh-tools no longer exports defineTool as a function — check dsh-tools version')
if (typeof dshHomePath !== 'function') throw new Error('dsh-deepseek-billing: @deepseek-ai/dsh-home-paths no longer exports dshHomePath as a function — check dsh-home-paths version')

export const name = '@dsh-external/dsh-deepseek-billing'
export const inject = ['credentials', 'subprocess', 'webServer', 'tools', 'llm', 'fs'] // timer 改软依赖（8.2）：headless/无 timer profile 也能激活；interval/timeout 经 ctx.inject 延迟注册

// 8.6 配置 schema（craft §6 / findings "craft 手法对账" #6）：
// 用户可在 profile 配置文件中覆盖这些参数；缺省值与硬编码常量一致，向后兼容。
// priceTables 保持模块级常量，不暴露为 Config 字段（嵌套过深、变化频率低、改动风险高）。
export const Config = z.object({
  turnQuietMs: z.number().default(3000).description('静默多久判定一轮结束（毫秒）'),
  pushThrottleMs: z.number().default(800).description('流式推送节流间隔（毫秒）'),
  balanceRefreshMs: z.number().default(5000).description('余额轮询间隔（毫秒）'),
  usageMaxRecords: z.number().default(2000).description('用量明细账本上限条数'),
  promptMaxChars: z.number().default(120).description('明细里单条提问截断长度'),
  usageDefaultSpanDays: z.number().default(7).description('usage 查询缺省时间窗（天）'),
}).default({})

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const STORAGE_PATH = dshHomePath('storages', 'deepseek-billing.json')
const SNAPSHOT_PATH = '/_dsh/deepseek-billing/snapshot'
const WS_PATH = '/_dsh/deepseek-billing/ws'
const USAGE_PATH = '/_dsh/deepseek-billing/usage'
const USAGE_MAX_RECORDS_DEFAULT = 2000 // 明细账本上限默认值（8.6 后可由 Config 覆盖）
const PROMPT_MAX_CHARS_DEFAULT = 120 // 明细里单条提问截断默认长度
const USAGE_DEFAULT_SPAN_MS_DEFAULT = 7 * 24 * 3600 * 1000 // usage 查询缺省时间窗：7 天
// 2026-08-17 00:00 北京时间 = 2026-08-16T16:00Z 起峰谷价
const PEAK_START_TS = Date.UTC(2026, 7, 16, 16, 0, 0)

// 平峰价（每百万 token）—— 官方 pricing 页，2026-08-17 前生效
const FLAT_PRICES = {
  pro: {
    CNY: { hit: 0.025, miss: 3, out: 6 },
    USD: { hit: 0.003625, miss: 0.435, out: 0.87 },
  },
  flash: {
    CNY: { hit: 0.02, miss: 1, out: 2 },
    USD: { hit: 0.0028, miss: 0.14, out: 0.28 },
  },
}

// 峰谷价（每百万 token）—— 2026-08-17 00:00 北京起；高峰=北京 9:00-12:00、14:00-18:00，高峰价=空闲价×2
const PEAK_PRICES = {
  pro: {
    CNY: { idle: { hit: 0.15, miss: 4.5, out: 13.5 }, peak: { hit: 0.30, miss: 9.0, out: 27.0 } },
    USD: { idle: { hit: 0.022, miss: 0.66, out: 1.98 }, peak: { hit: 0.044, miss: 1.32, out: 3.96 } },
  },
  flash: {
    CNY: { idle: { hit: 0.05, miss: 1.5, out: 4.5 }, peak: { hit: 0.10, miss: 3.0, out: 9.0 } },
    USD: { idle: { hit: 0.007, miss: 0.22, out: 0.66 }, peak: { hit: 0.014, miss: 0.44, out: 1.32 } },
  },
}

function errMsg(e) { return e && e.message ? String(e.message).slice(0, 200) : String(e).slice(0, 200) }

// 8.5 把计费快照渲染成给模型/人看的紧凑文本（结构化 JSON 仍在 execute 返回值里供程序消费；
// craft §2 output.render 分离原则）。复用 client 的金额自适应精度思路但简化为 2 位。
function renderBillingSnapshot(v) {
  if (!v || typeof v !== 'object') return String(v ?? '')
  const sym = v.currency === 'USD' ? '$' : '¥'
  const money = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : sym + Number(n).toFixed(2))
  const lines = [
    '余额 ' + money(v.current) + (v.currency ? '（' + v.currency + '）' : ''),
    '本轮已花费 ' + money(v.spent) + '（实时）',
    '上轮花费 ' + money(v.lastTurnCost),
    '上次对话余额 ' + money(v.last),
    '对话框开始余额 ' + money(v.dialogStartBalance),
  ]
  if (v.at) lines.push('更新时间 ' + new Date(v.at).toLocaleString())
  if (v.error) lines.push('错误: ' + v.error)
  return lines.join('\n')
}

// 是否 DeepSeek 系模型：只有这类模型有价目表，参与余额相关花费计算；
// 其他模型（如 GLM）照常记用量明细，但不折算费用（明细里显示 —）。
function isDeepseekCall(provider, model) {
  return /deepseek/i.test(String(provider || '')) || /deepseek/i.test(String(model || ''))
}

// 从请求消息里提取「这一轮的提问」：倒序找第一条含 text 块的 user 消息。
// 工具结果消息 role 也是 'user'，但块类型是 'tool-result'，天然被跳过。
function extractPrompt(messages, maxChars) {
  if (!Array.isArray(messages)) return ''
  const limit = maxChars || PROMPT_MAX_CHARS_DEFAULT
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue
    const text = m.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (text) return text.length > limit ? text.slice(0, limit - 1) + '…' : text
  }
  return ''
}

// 解析 usage 查询的 from/to（epoch ms，客户端按本地时区算好传上来）。
// 缺省回退最近 N 天（由 config.usageDefaultSpanDays 控制，默认 7 天）；from >= to 时交换；非法值回退默认窗口。
function parseUsageRange(searchParams, spanDays) {
  const now = Date.now()
  const spanMs = (spanDays || 7) * 24 * 3600 * 1000
  const defaultFrom = now - spanMs
  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  let from = num(searchParams.get('from')) || defaultFrom
  let to = num(searchParams.get('to')) || now
  if (from > to) { const t = from; from = to; to = t }
  return { from, to }
}

// 模型目录（显示名映射）：providers {id→name}、models {providerId→{modelId→name}}、
// defaultModel {provider, model}（读 settings.yaml 的 agent-default-model）。
// 来源 = ctx.llm.listProviders()/listModels() 官方目录 + settings 文件，30 秒缓存；
// 任何环节失败都容忍（返回尽量完整的部分结果或 null），明细显示端回退用 id。
let catalogCache = { at: 0, data: null }
// deps = { llm, fs }：apply 作用域显式传入（模块级无法直接引用 apply 内的 const）
async function buildCatalog(deps, force) {
  const llmSvc = deps && deps.llm
  if (llmSvc === undefined || typeof llmSvc.listProviders !== 'function') return null
  const now = Date.now()
  if (!force && catalogCache.data && now - catalogCache.at < 30000) return catalogCache.data
  const providers = llmSvc.listProviders()
  const providerNames = {}
  const modelNames = {}
  for (const p of Array.isArray(providers) ? providers : []) {
    if (!p || !p.id) continue
    providerNames[p.id] = p.name || p.id
    try {
      if (typeof llmSvc.listModels !== 'function') continue
      const list = await llmSvc.listModels(p.id)
      modelNames[p.id] = {}
      for (const m of Array.isArray(list) ? list : []) {
        if (m && m.id) modelNames[p.id][m.id] = m.name || m.id
      }
    } catch (e) { /* 单个提供方目录失败不影响整体 */ }
  }
  const catalog = { providers: providerNames, models: modelNames, defaultModel: await readDefaultModel(deps && deps.fs) }
  catalogCache = { at: now, data: catalog }
  return catalog
}

// 读 settings.yaml 顶层 agent-default-model 块（provider/model 两行），容错失败返回 null
async function readDefaultModel(fsSvc) {
  try {
    if (fsSvc === undefined) return null
    const target = await fsSvc.resolve(dshHomePath('settings.yaml'))
    const text = await fsSvc.readText(target)
    const lines = String(text).split(/\r?\n/)
    let inBlock = false, provider = null, model = null
    for (const line of lines) {
      if (/^agent-default-model:\s*$/.test(line)) { inBlock = true; continue }
      if (!inBlock) continue
      if (/^\S/.test(line)) break // 下一个顶层键，块结束
      const pm = line.match(/^\s+provider:\s*(\S+)/)
      if (pm) provider = pm[1]
      const mm = line.match(/^\s+model:\s*(\S+)/)
      if (mm) model = mm[1]
    }
    return provider && model ? { provider, model } : null
  } catch (e) { return null }
}

function isBeijingPeak(ts) {
  const d = new Date(ts + 8 * 3600 * 1000)
  const hour = d.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

function resolvePrice(model, currency, ts) {
  const family = String(model || '').includes('flash') ? 'flash' : 'pro'
  const cur = currency === 'USD' ? 'USD' : 'CNY'
  if (ts < PEAK_START_TS) {
    const p = FLAT_PRICES[family][cur]
    return { family, currency: cur, table: 'flat', peak: false, hit: p.hit, miss: p.miss, out: p.out }
  }
  const peak = isBeijingPeak(ts)
  const p = PEAK_PRICES[family][cur][peak ? 'peak' : 'idle']
  return { family, currency: cur, table: 'peak', peak, hit: p.hit, miss: p.miss, out: p.out }
}

// usage 字段：inputTokens=未命中输入、cacheReadTokens=命中、cacheWriteTokens=写入、outputTokens=输出、reasoningTokens=推理
function costOfUsage(usage, model, currency, ts) {
  const hit = usage.cacheReadTokens || 0
  const miss = (usage.inputTokens || 0) + (usage.cacheWriteTokens || 0)
  const out = (usage.outputTokens || 0) + (usage.reasoningTokens || 0)
  const price = resolvePrice(model, currency, ts)
  return (hit * price.hit + miss * price.miss + out * price.out) / 1e6
}

// 流式过程中的粗略估算：字符数按 3 字符≈1 token 折算输出价；usage 到达后会替换为精确值
function estimateCost(chars, reasoningChars, model, currency, ts) {
  const tokens = Math.ceil((chars + reasoningChars) / 3)
  const price = resolvePrice(model, currency, ts)
  return (tokens * price.out) / 1e6
}

export async function apply(ctx, config) {
  // 8.6 config 解析：schemastery 校验 + 边界兜底。smoke stub 无 Config 导出时用模块默认值。
  const cfg = {
    turnQuietMs: 3000,
    pushThrottleMs: 800,
    balanceRefreshMs: 5000,
    usageMaxRecords: 2000,
    promptMaxChars: 120,
    usageDefaultSpanDays: 7,
    ...(config && typeof config === 'object' ? config : {}),
  }
  const TURN_QUIET_MS = cfg.turnQuietMs
  const PUSH_THROTTLE_MS = cfg.pushThrottleMs
  const USAGE_MAX_RECORDS = cfg.usageMaxRecords
  const PROMPT_MAX_CHARS = cfg.promptMaxChars
  const USAGE_DEFAULT_SPAN_MS = cfg.usageDefaultSpanDays * 24 * 3600 * 1000

  const llm = ctx.llm
  const credentials = ctx.credentials
  const subprocess = ctx.subprocess
  const webServer = ctx.webServer
  const tools = ctx.tools
  const fs = ctx.fs

  const state = {
    current: null,
    last: null,
    lastGood: null, // 8.7: 最近一次成功获取的余额 { balance, currency, at }，fetch 失败时兜底
    lastActivityAt: 0,
    ended: true,
    error: null,
    currency: 'CNY',
    turnCost: 0,
    lastTurnCost: 0,
  }
  const activeStreams = new Set() // 每个元素 { est, chars, reasoning }
  let activeSessionId = null
  let fetching = false
  let lastPushAt = 0
  let ledger = { version: 4, dialogStarts: {}, usage: [] }
  let pendingUsage = null // 进行中一轮的明细记录，轮结束时落账
  let wss = null
  let lastPayloadKey = null
  const clients = new Set()
  const disposers = []

  function turnSpent() {
    let total = state.turnCost
    for (const s of activeStreams) total += s.est
    return total
  }

  async function loadLedger() {
    if (fs === undefined) return
    try {
      const target = await fs.resolve(STORAGE_PATH)
      const text = await fs.readText(target)
      const data = JSON.parse(text)
      if (data && typeof data === 'object') {
        ledger = { ...data, version: 4 }
        if (!ledger.dialogStarts || typeof ledger.dialogStarts !== 'object') ledger.dialogStarts = {}
        if (!Array.isArray(ledger.usage)) ledger.usage = []
        // 8.7: 从账本恢复 lastGood 缓存，重启后首次 fetch 失败时面板有兜底值
        if (data.lastGood && typeof data.lastGood.balance === 'number') {
          state.lastGood = data.lastGood
          if (state.current === null) {
            state.current = data.lastGood.balance
            if (data.lastGood.currency) state.currency = data.lastGood.currency
          }
        }
      }
    } catch (e) { /* 首次运行无账本文件属正常 */ }
  }

  // 8.8 账本原子写：先写 .tmp，再 rename 替换目标文件。
  // 若 fs 服务提供 rename 则优先用它；否则用 Node rename（本插件存储路径始终本地）；
  // 都失败时降级为直接写目标，保证可用性。
  async function saveLedger() {
    if (fs === undefined) return
    try {
      const tmpPath = STORAGE_PATH + '.tmp'
      const tmpTarget = await fs.resolve(tmpPath)
      await fs.writeText(tmpTarget, JSON.stringify(ledger))
      if (typeof fs.rename === 'function') {
        const target = await fs.resolve(STORAGE_PATH)
        await fs.rename(tmpTarget, target)
      } else {
        try {
          await nodeRename(tmpPath, STORAGE_PATH)
        } catch (e) {
          const target = await fs.resolve(STORAGE_PATH)
          await fs.writeText(target, JSON.stringify(ledger))
        }
      }
    } catch (e) {
      console.warn('[deepseek-billing] ledger save failed:', errMsg(e))
    }
  }

  function getDialogStart(sessionId) {
    if (!sessionId) return null
    return (ledger.dialogStarts && ledger.dialogStarts[sessionId]) || null
  }

  // 一轮结束：把进行中的明细记录落账。费用口径 = 本轮 DeepSeek 系调用的实际花费
  // （与面板「上轮花费」一致，含本轮内发生的辅助调用费用）；非 DeepSeek 模型（如 GLM）
  // 无价目表，cost 记 null，明细里显示 —。
  function finalizeUsage(cost) {
    const rec = pendingUsage
    pendingUsage = null
    if (!rec || rec.calls === 0) return
    ledger.usage = ledger.usage || []
    ledger.usage.push({
      at: rec.at,
      sessionId: rec.sessionId,
      model: rec.models.join(' + ') || 'unknown',
      provider: rec.providers.join(' + ') || 'DSH',
      prompt: rec.prompt,
      cost: rec.pricedCalls > 0 ? Number(cost.toFixed(4)) : null,
      calls: rec.calls,
    })
    if (ledger.usage.length > USAGE_MAX_RECORDS) ledger.usage = ledger.usage.slice(-USAGE_MAX_RECORDS)
    saveLedger()
  }

  async function ensureDialogStart(sessionId) {
    if (!sessionId) return null
    const existing = getDialogStart(sessionId)
    if (existing && typeof existing.balance === 'number') return existing
    if (state.current === null) return null
    ledger.dialogStarts = ledger.dialogStarts || {}
    ledger.dialogStarts[sessionId] = { balance: state.current, at: Date.now() }
    await saveLedger()
    return ledger.dialogStarts[sessionId]
  }

  function snapshot(sessionId) {
    const sid = sessionId || activeSessionId || null
    const start = getDialogStart(sid)
    return {
      current: state.current,
      last: state.last,
      spent: turnSpent(),
      lastTurnCost: state.lastTurnCost,
      currency: state.currency,
      sessionId: sid,
      dialogStartBalance: start && typeof start.balance === 'number' ? start.balance : null,
      at: Date.now(),
      error: state.error,
    }
  }

  function maybePush(force) {
    const now = Date.now()
    if (!force && now - lastPushAt < PUSH_THROTTLE_MS) return
    lastPushAt = now
    broadcast()
  }

  function broadcast() {
    const snap = snapshot()
    const key = JSON.stringify({
      current: snap.current,
      last: snap.last,
      spent: snap.spent,
      lastTurnCost: snap.lastTurnCost,
      currency: snap.currency,
      error: snap.error,
      sessionId: snap.sessionId,
      dialogStartBalance: snap.dialogStartBalance,
    })
    if (key === lastPayloadKey) return
    lastPayloadKey = key
    const payload = JSON.stringify(snap)
    for (const client of clients) {
      if (client.readyState === 1) {
        try { client.send(payload) } catch (e) { /* 忽略单个客户端发送失败 */ }
      }
    }
  }

  function setupWebSocket() {
    if (webServer === undefined || wss !== null) return
    wss = new WebSocketServer({ noServer: true })
    wss.on('connection', (ws) => {
      clients.add(ws)
      try { ws.send(JSON.stringify(snapshot())) } catch (e) { /* 首帧发送失败忽略 */ }
      ws.on('close', () => clients.delete(ws))
      ws.on('error', () => clients.delete(ws))
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(String(data))
          if (msg && msg.type === 'refresh') {
            fetchBalance().then(() => broadcast())
          }
        } catch (e) { /* 非 JSON 或未知消息忽略 */ }
      })
    })
    const dispose = webServer.registerUpgrade({
      path: WS_PATH,
      handler: (req, socket, head) => {
        try {
          wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
        } catch (e) {
          socket.destroy()
        }
      },
    })
    disposers.push(() => {
      dispose()
      for (const client of clients) { try { client.close() } catch (e) { /* 忽略 */ } }
      clients.clear()
      try { wss.close() } catch (e) { /* 忽略 */ }
      wss = null
    })
  }

  async function runFetch(argv, viaEnv, key) {
    if (subprocess === undefined) return { ok: false, error: 'subprocess 服务不可用' }
    let handle
    try {
      handle = subprocess.spawn({ argv, cwd: process.cwd(), stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } }, graceMs: 30000, env: viaEnv ? { DSK: key } : undefined })
    } catch (e) { return { ok: false, error: 'spawn 失败: ' + errMsg(e) } }
    let outcome
    try { outcome = await handle.done } catch (e) { return { ok: false, error: '进程失败: ' + errMsg(e) } }
    const out = handle.collected && handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const err = handle.collected && handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    if (outcome.exitCode !== 0) return { ok: false, error: '抓取失败(exit ' + outcome.exitCode + '): ' + err.slice(0, 200) }
    try { return { ok: true, data: JSON.parse(out) } } catch (e) { return { ok: false, error: '响应解析失败: ' + errMsg(e) } }
  }

  async function fetchViaNode(key) {
    let result = { ok: false, error: 'no fetch path' }
    try {
      const nodeExe = await subprocess.resolveExecutable('node.exe')
      const script = "fetch('" + BALANCE_URL + "',{headers:{'Authorization':'Bearer '+process.env.DSK}}).then(function(r){return r.text().then(function(t){if(r.status!==200){console.error('HTTP '+r.status);process.exit(1)}process.stdout.write(t)})}).catch(function(e){console.error(String(e&&e.message||e));process.exit(1)})"
      result = await runFetch([nodeExe, '-e', script], true, key)
    } catch (e) {
      try {
        const curlExe = await subprocess.resolveExecutable('curl.exe')
        result = await runFetch(['cmd.exe', '/d', '/s', '/c', 'curl.exe -sS -m 25 -H "Authorization: Bearer %DSK%" ' + BALANCE_URL], true, key)
      } catch (e2) { result = { ok: false, error: '无法启动 node/curl: ' + errMsg(e2) } }
    }
    return result
  }

  async function fetchBalance() {
    if (fetching) return
    fetching = true
    try {
      if (credentials === undefined) { state.error = 'credentials 服务不可用'; return }
      let cred
      try { cred = await credentials.resolve('DEEPSEEK_API_KEY') } catch (e) { state.error = '读取凭据失败: ' + errMsg(e); return }
      const key = cred && typeof cred === 'object' && cred.value !== undefined ? cred.value : (typeof cred === 'string' ? cred : undefined)
      if (key === undefined || key === '') { state.error = '未配置 DEEPSEEK_API_KEY'; return }
      const result = await fetchViaNode(key)
      if (result.ok) {
        const info = Array.isArray(result.data.balance_infos) ? result.data.balance_infos[0] : null
        if (info && info.total_balance !== undefined) {
          const n = parseFloat(info.total_balance)
          if (!Number.isNaN(n)) {
            state.current = n
            state.error = null
            if (info.currency === 'USD' || info.currency === 'CNY') state.currency = info.currency
            // 8.7: 成功时更新 lastGood 缓存并持久化，下次 fetch 失败时可兜底
            state.lastGood = { balance: n, currency: state.currency, at: Date.now() }
            ledger.lastGood = state.lastGood
            saveLedger()
            if (activeSessionId) await ensureDialogStart(activeSessionId)
            broadcast()
          }
        } else { state.error = '余额数据解析失败' }
      } else {
        // 8.7: fetch 失败时，如果有 lastGood，用缓存值兜底显示，不显示 null/—
        state.error = result.error
        if (state.lastGood && typeof state.lastGood.balance === 'number') {
          state.current = state.lastGood.balance
          if (state.lastGood.currency) state.currency = state.lastGood.currency
        }
      }
    } catch (e) { state.error = errMsg(e) } finally { fetching = false }
  }

  if (llm !== undefined) {
    ctx.on('llm/stream', (options, next) => {
      const auxiliary = !!(options && options.purpose) // 压缩/会话标题等辅助调用：计入花费但不产生明细行
      const priced = isDeepseekCall(options && options.provider, options && options.model) // 仅 DeepSeek 系模型有价目表
      if (!auxiliary) {
        if (options && options.sessionId) activeSessionId = options.sessionId
        // 新一轮开始：清掉上一轮的花费，并开一条新的用量明细记录
        if (state.ended) {
          state.turnCost = 0
          activeStreams.clear()
          state.ended = false
          pendingUsage = {
            at: Date.now(),
            sessionId: (options && options.sessionId) || null,
            models: [],
            providers: [],
            prompt: extractPrompt(options && options.messages, PROMPT_MAX_CHARS),
            calls: 0,
            pricedCalls: 0,
          }
        }
        if (pendingUsage) {
          pendingUsage.calls++
          if (priced) pendingUsage.pricedCalls++
          const model = options && options.model ? String(options.model) : 'unknown'
          if (!pendingUsage.models.includes(model)) pendingUsage.models.push(model)
          const provider = options && options.provider ? String(options.provider) : ''
          if (provider && !pendingUsage.providers.includes(provider)) pendingUsage.providers.push(provider)
        }
      }
      const stream = next()
      const tracker = { est: 0, chars: 0, reasoning: 0, priced }
      activeStreams.add(tracker)
      return (async function* () {
        try {
          for await (const chunk of stream) {
            state.lastActivityAt = Date.now()
            state.ended = false
            if (chunk && chunk.type === 'text-delta' && chunk.text) tracker.chars += chunk.text.length
            else if (chunk && chunk.type === 'reasoning-delta' && chunk.text) tracker.reasoning += chunk.text.length
            if (chunk && chunk.type === 'usage' && chunk.usage && tracker.priced) {
              const exact = costOfUsage(chunk.usage, options && options.model, state.currency, Date.now())
              state.turnCost += exact
              activeStreams.delete(tracker)
            }
            tracker.est = tracker.priced ? estimateCost(tracker.chars, tracker.reasoning, options && options.model, state.currency, Date.now()) : 0
            yield chunk
            maybePush(false)
          }
        } finally {
          if (activeStreams.has(tracker)) activeStreams.delete(tracker)
          maybePush(true)
        }
      })()
    })
  }

  // timer 软依赖（8.2 / craft §4）：核心 = 余额 + 计费，timer 仅轮询；headless/无 timer
  // profile 下插件仍能激活，deepseek_billing 工具按需取数不受影响。
  // dual-path：真实 cordis 走 ctx.inject(['timer'], cb) 等服务就绪再注册；smoke stub
  // 无 ctx.inject，走 else 直接 setupTimers()，让 interval 断言（ms===2000 && ms===5000）通过。
  const setupTimers = () => {
    // 每 2 秒检查：静默超过阈值 → 判定一轮结束 → 拉一次余额存为「上次余额」，重置本轮花费
    ctx.interval(() => {
      const now = Date.now()
      if (!state.ended && state.lastActivityAt > 0 && now - state.lastActivityAt > TURN_QUIET_MS) {
        state.ended = true
        state.lastTurnCost = turnSpent()
        finalizeUsage(state.lastTurnCost)
        activeStreams.clear()
        state.turnCost = 0
        fetchBalance().then(() => {
          if (state.current !== null) state.last = state.current
          if (activeSessionId) ensureDialogStart(activeSessionId)
          broadcast()
        })
      }
    }, 2000)

    // 每 5 秒刷新当前余额；有变化时 WebSocket 自动推送
    ctx.interval(() => { fetchBalance() }, 5000)
    ctx.timeout(() => { fetchBalance() }, 1000)
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['timer'], () => setupTimers())
  } else {
    setupTimers()
  }

  await loadLedger()

  if (webServer !== undefined) {
    const dispose = webServer.register({
      kind: 'exact',
      path: SNAPSHOT_PATH,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const sid = url.searchParams.get('sessionId') || activeSessionId
          if (url.searchParams.get('refresh') === '1') {
            await fetchBalance()
            if (sid) await ensureDialogStart(sid)
          }
          let catalog = null
          try { catalog = await buildCatalog({ llm, fs }) } catch (e) { catalog = null }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ...snapshot(sid), catalog }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: errMsg(e) }))
        }
      },
    })
    disposers.push(dispose)

    // 用量明细查询：?from=<epoch ms>&to=<epoch ms>（半开区间 [from, to)），缺省最近 7 天
    const disposeUsage = webServer.register({
      kind: 'exact',
      path: USAGE_PATH,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const { from, to } = parseUsageRange(url.searchParams, cfg.usageDefaultSpanDays)
          const records = (ledger.usage || [])
            .filter((r) => r && r.at >= from && r.at < to)
            .sort((a, b) => b.at - a.at)
          const total = records.reduce((s, r) => s + (Number(r.cost) || 0), 0)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ records, total, count: records.length, currency: state.currency, catalog: await buildCatalog({ llm, fs }), at: Date.now() }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: errMsg(e) }))
        }
      },
    })
    disposers.push(disposeUsage)

    try {
      setupWebSocket()
    } catch (e) {
      console.warn('[deepseek-billing] websocket setup failed:', errMsg(e))
    }
  }

  // 8.4 systemPrompt 软注入（craft §9d / bridge-browser 同款）：告诉模型余额/花费问题先调本工具。
  // ctx.get 是软获取（不进 inject）；smoke stub 无 ctx.get，typeof 守卫后跳过，不影响冒烟。
  const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined
  if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    ctx.effect(() => systemPrompt.section({
      name: 'tool:deepseek-billing',
      order: 107,
      text: 'A billing tool may be available. When the user asks about account balance, per-turn or session spending, pricing, or how much a conversation cost, call deepseek_billing (no parameters) for a live snapshot rather than guessing.',
    }), 'deepseek-billing: system prompt section')
  }

  // 8.5 deepseek_billing 工具：description 按四问结构化（何时用/返回什么/数据来源/出错怎么办）；
  // output.render 改紧凑文本（craft §2），替代整段 JSON。
  if (tools !== undefined) {
    tools.register(defineTool({
      name: 'deepseek_billing',
      description:
        'Query DeepSeek account balance and live in-session billing. ' +
        'WHEN TO USE: user asks 「余额多少」「这次/上一轮花了多少钱」「对话框开始余额」「现在实时花了多少」, pricing, or how much a conversation cost. ' +
        'RETURNS: current balance, last-turn-end balance, this-turn live spend, last-turn cost, dialog-start balance, currency. ' +
        'DATA SOURCE: official /user/balance API (polled) + llm/stream token metering; no usage-history REST API exists. ' +
        'ON ERROR: returns an `error` field string; surface it to the user. No parameters.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_a, v) => [{ type: 'text', text: renderBillingSnapshot(v) }],
      },
      async execute() {
        await fetchBalance()
        return snapshot(activeSessionId)
      },
    }))
  }

  // 清理契约（8.3 / craft §9b）：只显式 dispose 返回了 disposer 的注册（webserver routes +
  // upgrade 路由 + wss）；ctx.on('llm/stream') 与 ctx.interval/timeout 由 cordis 按当前作用域
  // 自动清理，无需也不应在此手动解绑（bridge-browser 同款做法——它只对返回 disposer 的注册用
  // ctx.effect）。label 便于 HMR/卸载诊断时看到「谁没清理」。
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch (e) { /* 忽略清理错误 */ }
    }
    if (wss !== null) {
      for (const client of clients) { try { client.close() } catch (e) { /* 忽略 */ } }
      clients.clear()
      try { wss.close() } catch (e) { /* 忽略 */ }
      wss = null
    }
  }, 'deepseek-billing: cleanup (webserver routes + wss)')

  console.log('[deepseek-billing] host ready')
}
