/**
 * @dsh-external/dsh-deepseek-billing — Host half
 * DeepSeek Harness 余额悬浮窗（实时同步版）：
 *  - 当前余额 / 上一轮结束余额 / 本轮花费（余额差值模型）
 *  - 对话框开始余额：按 sessionId 持久化到 ~/.dsh/storages/deepseek-billing.json
 *  - WebSocket 实时推送快照 + HTTP 快照路由 + 模型工具 deepseek_billing
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WebSocketServer } from 'ws'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

export const name = '@dsh-external/dsh-deepseek-billing'
export const inject = ['timer', 'credentials', 'subprocess', 'webServer', 'tools', 'llm', 'fs']

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const TURN_QUIET_MS = 3000 // 连续 3 秒无模型调用即判定一轮结束
const STORAGE_PATH = dshHomePath('storages', 'deepseek-billing.json')
const SNAPSHOT_PATH = '/_dsh/deepseek-billing/snapshot'
const WS_PATH = '/_dsh/deepseek-billing/ws'

function errMsg(e) { return e && e.message ? String(e.message).slice(0, 200) : String(e).slice(0, 200) }

export async function apply(ctx) {
  const llm = ctx.llm
  const credentials = ctx.credentials
  const subprocess = ctx.subprocess
  const webServer = ctx.webServer
  const tools = ctx.tools
  const fs = ctx.fs

  const state = { current: null, last: null, lastActivityAt: 0, ended: true, error: null }
  let activeSessionId = null
  let fetching = false
  let ledger = { version: 3, dialogStarts: {} }
  let wss = null
  let lastPayloadKey = null
  const clients = new Set()
  const disposers = []

  async function loadLedger() {
    if (fs === undefined) return
    try {
      const target = await fs.resolve(STORAGE_PATH)
      const text = await fs.readText(target)
      const data = JSON.parse(text)
      if (data && typeof data === 'object') {
        ledger = { ...data, version: 3 }
        if (!ledger.dialogStarts || typeof ledger.dialogStarts !== 'object') ledger.dialogStarts = {}
      }
    } catch (e) { /* 首次运行无账本文件属正常 */ }
  }

  async function saveLedger() {
    if (fs === undefined) return
    try {
      const target = await fs.resolve(STORAGE_PATH)
      await fs.writeText(target, JSON.stringify(ledger))
    } catch (e) {
      console.warn('[deepseek-billing] ledger save failed:', errMsg(e))
    }
  }

  function getDialogStart(sessionId) {
    if (!sessionId) return null
    return (ledger.dialogStarts && ledger.dialogStarts[sessionId]) || null
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
    const spent = (state.last !== null && state.current !== null) ? Math.max(0, state.last - state.current) : null
    const start = getDialogStart(sid)
    return {
      current: state.current,
      last: state.last,
      spent,
      sessionId: sid,
      dialogStartBalance: start && typeof start.balance === 'number' ? start.balance : null,
      at: Date.now(),
      error: state.error,
    }
  }

  function broadcast() {
    const snap = snapshot()
    const key = JSON.stringify({
      current: snap.current,
      last: snap.last,
      spent: snap.spent,
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
            if (activeSessionId) await ensureDialogStart(activeSessionId)
            broadcast()
          }
        } else { state.error = '余额数据解析失败' }
      } else { state.error = result.error }
    } catch (e) { state.error = errMsg(e) } finally { fetching = false }
  }

  if (llm !== undefined) {
    ctx.on('llm/stream', (options, next) => {
      if (options && options.sessionId) {
        activeSessionId = options.sessionId
        if (state.current !== null) ensureDialogStart(activeSessionId)
      }
      const stream = next()
      return (async function* () {
        for await (const chunk of stream) {
          state.lastActivityAt = Date.now()
          state.ended = false
          yield chunk
        }
      })()
    })
  }

  // 每 2 秒检查：静默超过阈值 → 判定一轮结束 → 拉一次余额存为「上次余额」并实时推送
  ctx.interval(() => {
    const now = Date.now()
    if (!state.ended && state.lastActivityAt > 0 && now - state.lastActivityAt > TURN_QUIET_MS) {
      state.ended = true
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
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(snapshot(sid)))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: errMsg(e) }))
        }
      },
    })
    disposers.push(dispose)

    try {
      setupWebSocket()
    } catch (e) {
      console.warn('[deepseek-billing] websocket setup failed:', errMsg(e))
    }
  }

  if (tools !== undefined) {
    tools.register(defineTool({
      name: 'deepseek_billing',
      description: '查询 DeepSeek API 账户余额与本地轮次花费：返回当前余额(current)、上一轮结束时的余额(last)、本轮已花费(spent = last - current)、当前对话框开始余额(dialogStartBalance)。用户问「余额多少」「这次/上一轮花了多少钱」「对话框开始余额」时使用。输入无参数。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute() {
        await fetchBalance()
        return snapshot(activeSessionId)
      },
    }))
  }

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
  })

  console.log('[deepseek-billing] host ready')
}
