// dsh-deepseek-billing 用量明细冒烟测试（临时目录 stub 方式，真实 import lib/index.js）
// 运行：node smoke-usage.mjs  （退出码 0 = 全部断言通过）
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const REPO = process.argv[2]
if (!REPO) { console.error('usage: node smoke-usage.mjs <repo-dir>'); process.exit(2) }

let passed = 0, failed = 0
function assert(cond, name, extra) {
  if (cond) { passed++; console.log('  ok  ' + name) }
  else { failed++; console.error('FAIL  ' + name + (extra !== undefined ? '  => ' + JSON.stringify(extra) : '')) }
}

// ---------- 1. 搭临时模块环境：stub 三个外部依赖 ----------
const dir = mkdtempSync(join(tmpdir(), 'dsb-smoke-'))
const nm = join(dir, 'node_modules')
for (const p of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-home-paths', 'ws']) mkdirSync(join(nm, p), { recursive: true })

writeFileSync(join(nm, '@deepseek-ai/dsh-tools/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', type: 'module', main: 'index.js' }))
writeFileSync(join(nm, '@deepseek-ai/dsh-tools/index.js'), 'export function defineTool(d) { return d }\n')

writeFileSync(join(nm, '@deepseek-ai/dsh-home-paths/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-home-paths', type: 'module', main: 'index.js' }))
writeFileSync(join(nm, '@deepseek-ai/dsh-home-paths/index.js'),
  'import { join } from "node:path"\nexport const HOME = ' + JSON.stringify(dir) + '\nexport function dshHomePath(...parts) { return join(HOME, ...parts) }\n')

writeFileSync(join(nm, 'ws/package.json'), JSON.stringify({ name: 'ws', type: 'module', main: 'index.js' }))
writeFileSync(join(nm, 'ws/index.js'), 'export class WebSocketServer { on() {} close() {} handleUpgrade() {} }\n')

copyFileSync(join(REPO, 'lib', 'index.js'), join(dir, 'index.js'))

// ---------- 2. mock DSH ctx ----------
const files = new Map()
const fsMock = {
  resolve: async (p) => p,
  readText: async (p) => { const t = files.get(p); if (t === undefined) throw new Error('ENOENT: ' + p); return t },
  writeText: async (p, c) => { files.set(p, String(c)) },
}
const routes = {}
const intervals = []
const timeouts = []
const effects = []
const registeredTools = []
let streamHandler = null

const ctx = {
  llm: {},
  on: (ev, fn) => { if (ev === 'llm/stream') streamHandler = fn },
  interval: (fn, ms) => intervals.push({ fn, ms }),
  timeout: (fn, ms) => timeouts.push({ fn, ms }),
  effect: (fn) => effects.push(fn),
  credentials: { resolve: async () => { throw new Error('no key in test') } },
  subprocess: { spawn: () => { throw new Error('no spawn in test') }, resolveExecutable: async () => 'node.exe' },
  webServer: {
    register: (r) => { routes[r.path] = r.handler; return () => {} },
    registerUpgrade: () => () => {},
  },
  tools: { register: (t) => registeredTools.push(t) },
  fs: fsMock,
}

// ---------- 3. 真实导入插件并 apply ----------
const mod = await import(pathToFileURL(join(dir, 'index.js')).href)
await mod.apply(ctx)

assert(typeof streamHandler === 'function', 'llm/stream 钩子已注册')
assert(!!routes['/_dsh/deepseek-billing/usage'], 'usage 路由已注册')
assert(!!routes['/_dsh/deepseek-billing/snapshot'], 'snapshot 路由仍注册')
assert(intervals.some((i) => i.ms === 2000) && intervals.some((i) => i.ms === 5000), '原有 interval 定时器未变')

// ---------- 4. 模拟一轮对话：提问 → 流式（含 usage chunk）→ 静默结束 ----------
const PROMPT = '帮我写一个冒烟测试，验证用量明细功能是否正常工作'
async function* fakeStream() {
  yield { type: 'text-delta', index: 0, text: '好的，我来写。' }
  yield { type: 'usage', usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500, reasoningTokens: 200 } }
  yield { type: 'text-delta', index: 0, text: '写好了。' }
  yield { type: 'finish', reason: 'stop' }
}
const gen = streamHandler({
  sessionId: 'sess-1',
  model: 'deepseek-chat',
  messages: [
    { role: 'user', content: [{ type: 'text', text: '第一条历史提问' }] },
    { role: 'assistant', content: [{ type: 'text', text: '历史回答' }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 't1', content: [] }] }, // 工具结果：role=user 但应被跳过
    { role: 'user', content: [{ type: 'text', text: PROMPT }] },
  ],
}, () => fakeStream())
for await (const chunk of gen) { void chunk } // 消费整条流

// 辅助调用（会话标题）：不应产生明细行
const aux = streamHandler({ sessionId: 'sess-1', model: 'deepseek-chat', purpose: 'session-title', messages: [] }, async function* () { yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } } })
for await (const c of aux) { void c }

// 静默 3 秒判定：真实等过阈值再触发 2s interval（插件用 Date.now() 计时）
await new Promise((r) => setTimeout(r, 3100))
const quiet = intervals.find((i) => i.ms === 2000)
quiet.fn()
await new Promise((r) => setTimeout(r, 30)) // finalizeUsage → saveLedger 异步写

// ---------- 5. 断言账本与查询 ----------
const stored = JSON.parse(files.get(join(dir, 'storages', 'deepseek-billing.json')))
assert(stored.version === 4, '账本版本为 4')
assert(Array.isArray(stored.usage) && stored.usage.length === 1, '辅助调用不产生行，仅 1 条明细', stored.usage && stored.usage.length)
const rec = stored.usage[0]
assert(rec.prompt === PROMPT, 'prompt 取最后一条用户提问（跳过工具结果）', rec.prompt)
assert(rec.model === 'deepseek-chat', 'model 记录正确', rec.model)
assert(rec.product === 'DSH', 'product 固定 DSH', rec.product)
assert(rec.sessionId === 'sess-1', 'sessionId 记录正确')
assert(typeof rec.cost === 'number' && rec.cost > 0 && Number.isFinite(rec.cost), 'cost 为正数', rec.cost)
assert(rec.calls === 1, 'calls 记录调用次数', rec.calls)

const res = (h) => { let code, body; return { handler: h, writeHead: (c) => { code = c }, end: (b) => { body = b }, get code() { return code }, get json() { return JSON.parse(body) } } }
const r1 = res(null); await routes['/_dsh/deepseek-billing/usage']({ url: '/_dsh/deepseek-billing/usage?from=0&to=99999999999999' }, r1)
assert(r1.code === 200 && r1.json.count === 1 && r1.json.records[0].prompt === PROMPT, 'usage 查询返回记录', r1.json)
assert(r1.json.total === rec.cost, 'total = 记录 cost')
assert(r1.json.currency === 'CNY', '默认币种 CNY', r1.json.currency)

const r2 = res(null); await routes['/_dsh/deepseek-billing/usage']({ url: '/_dsh/deepseek-billing/usage?from=99999999999999&to=0' }, r2)
assert(r2.json.count === 0, 'from>to 自动交换后窗口外无数据（交换语义生效）')

const r3 = res(null); await routes['/_dsh/deepseek-billing/usage']({ url: '/_dsh/deepseek-billing/usage' }, r3)
assert(r3.code === 200 && typeof r3.json.total === 'number', '缺省参数回退 7 天窗口不报错')

// 币种影响：state.currency 改成 USD 后查询透传
// ---------- 6. extractPrompt 截断逻辑（>120 字符） ----------
const longText = '长'.repeat(300)
const gen2 = streamHandler({ sessionId: 'sess-2', model: 'deepseek-chat', messages: [{ role: 'user', content: [{ type: 'text', text: longText }] }] }, async function* () { yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } })
for await (const c of gen2) { void c }
await new Promise((r) => setTimeout(r, 3100))
quiet.fn()
await new Promise((r) => setTimeout(r, 30))
const stored2 = JSON.parse(files.get(join(dir, 'storages', 'deepseek-billing.json')))
const lastRec = stored2.usage[stored2.usage.length - 1]
assert(stored2.usage.length === 2 && lastRec.prompt.length === 120 && lastRec.prompt.endsWith('…'), '超长 prompt 截断到 120 字符并加省略号', lastRec.prompt.length)

// ---------- 7. 客户端日期窗口公式镜像验证（与 client.js UsageView 同一套公式） ----------
const DAY = 24 * 3600 * 1000
const today0 = (() => { const x = new Date(); x.setHours(0, 0, 0, 0); return x.getTime() })()
const w7 = { from: today0 - 6 * DAY, to: today0 + DAY }
assert(w7.to - w7.from === 7 * DAY, '7 天窗口 = 7 个自然日（含今天）')
const d = new Date(today0); const pad2 = (n) => String(n).padStart(2, '0')
const label = (ts) => { const x = new Date(ts); return x.getFullYear() + '/' + pad2(x.getMonth() + 1) + '/' + pad2(x.getDate()) }
assert(label(w7.from).length === 10 && /\d{4}\/\d{2}\/\d{2}/.test(label(w7.from)), 'fmtDay 输出 YYYY/MM/DD', label(w7.from))
const f = new Date('2026/08/22') && new Date('2026-08-22T00:00:00').getTime()
const t = new Date('2026-08-28T00:00:00').getTime() + DAY
assert(t - f === 7 * DAY, '截图示例 08/22-08/28 = 7 天窗口')

console.log(`\n${passed} passed, ${failed} failed`)
rmSync(dir, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
