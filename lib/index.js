/**
 * @dsh-external/dsh-deepseek-billing — Host half
 * DeepSeek Harness 余额悬浮窗：纯余额差值模型。
 * 当前余额 / 上一轮结束余额 / 本轮花费 = 上次余额 − 当前余额。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = '@dsh-external/dsh-deepseek-billing'
export const inject = ['timer', 'credentials', 'subprocess', 'webServer', 'tools', 'llm']

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const TURN_QUIET_MS = 3000 // 连续 3 秒无模型调用即判定一轮结束

function errMsg(e) { return e && e.message ? String(e.message).slice(0, 200) : String(e).slice(0, 200) }

export async function apply(ctx) {
  const llm = ctx.llm
  const credentials = ctx.credentials
  const subprocess = ctx.subprocess
  const webServer = ctx.webServer
  const tools = ctx.tools

  const state = { current: null, last: null, lastActivityAt: 0, ended: true, error: null }
  let fetching = false

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
          if (!Number.isNaN(n)) { state.current = n; state.error = null }
        } else { state.error = '余额数据解析失败' }
      } else { state.error = result.error }
    } catch (e) { state.error = errMsg(e) } finally { fetching = false }
  }

  function snapshot() {
    const spent = (state.last !== null && state.current !== null) ? Math.max(0, state.last - state.current) : null
    return { current: state.current, last: state.last, spent, at: Date.now(), error: state.error }
  }

  if (llm !== undefined) {
    ctx.on('llm/stream', (options, next) => {
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

  // 每 2 秒检查：静默超过阈值 → 判定一轮结束 → 拉一次余额存为「上次余额」
  ctx.interval(() => {
    const now = Date.now()
    if (!state.ended && state.lastActivityAt > 0 && now - state.lastActivityAt > TURN_QUIET_MS) {
      state.ended = true
      fetchBalance().then(() => { if (state.current !== null) state.last = state.current })
    }
  }, 2000)

  // 每 5 秒刷新当前余额
  ctx.interval(() => { fetchBalance() }, 5000)
  ctx.timeout(() => { fetchBalance() }, 1000)

  if (webServer !== undefined) {
    webServer.register({
      kind: 'exact',
      path: '/_dsh/deepseek-billing/snapshot',
      handler: async (req, res) => {
        try {
          if (new URL(req.url || '/', 'http://localhost').searchParams.get('refresh') === '1') await fetchBalance()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(snapshot()))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: errMsg(e) }))
        }
      },
    })
  }

  if (tools !== undefined) {
    tools.register(defineTool({
      name: 'deepseek_billing',
      description: '查询 DeepSeek API 账户余额与本地轮次花费：返回当前余额(current)、上一轮结束时的余额(last)、本轮已花费(spent = last - current)。用户问「余额多少」「这次/上一轮花了多少钱」时使用。输入无参数。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute() { await fetchBalance(); return snapshot() },
    }))
  }

  console.log('[deepseek-billing] host ready')
}
