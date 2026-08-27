window.__ModuleLoader__.load({ id: "@dsh-external/dsh-deepseek-billing", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const React = require("react");
const SNAPSHOT_URL = '/_dsh/deepseek-billing/snapshot';
const WS_URL = '/_dsh/deepseek-billing/ws';
const USAGE_URL = '/_dsh/deepseek-billing/usage';
const DAY_MS = 24 * 3600 * 1000;

function pad2(n) { return String(n).padStart(2, '0') }
function fmtDay(ts) { const d = new Date(ts); return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) }
function fmtTime(ts) { const d = new Date(ts); return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }

const CSS = '.dsb-panel{position:fixed;top:64px;right:16px;z-index:99990;width:224px;pointer-events:auto;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.95));color:var(--dsw-alias-label-primary,#1f2328);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.16);font-size:13px;line-height:1.5;user-select:none;cursor:grab;backdrop-filter:blur(10px)}.dsb-panel:active{cursor:grabbing}.dsb-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 6px}.dsb-title{font-weight:600}.dsb-btn{cursor:pointer;border:none;background:none;color:var(--dsw-alias-label-secondary,#667);font:inherit;padding:4px 6px;line-height:1;min-width:26px;min-height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px}.dsb-btn:hover{background:var(--dsw-alias-border-l1,rgba(128,128,128,.15))}.dsb-body{padding:0 10px 10px;display:flex;flex-direction:column;gap:6px}.dsb-row{display:flex;justify-content:space-between;align-items:baseline}.dsb-row b{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:600}.dsb-cur{border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));padding-bottom:6px}.dsb-label{color:var(--dsw-alias-label-secondary,#667)}.dsb-cur-num{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:24px;font-weight:700}.dsb-panel-low .dsb-cur-num,.dsb-panel-low b{color:var(--dsw-alias-state-error-primary,#cf222e)}.dsb-err{color:var(--dsw-alias-state-error-primary,#cf222e);font-size:11px;cursor:help}.dsb-cap{position:fixed;top:64px;right:16px;z-index:99990;pointer-events:auto;display:inline-block;width:fit-content;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.95));color:var(--dsw-alias-label-primary,#1f2328);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.16);padding:5px 14px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700;cursor:grab;user-select:none;backdrop-filter:blur(10px)}.dsb-cap-low{color:var(--dsw-alias-state-error-primary,#cf222e)}';

// 用量明细视图样式（数组 join 便于逐行维护）
const USAGE_CSS = [
  '/* ---- 用量明细视图 ---- */',
  '.dsb-panel.dsb-panel-usage{width:660px;max-width:calc(100vw - 24px)}',
  '.dsb-btn-txt{min-width:0;padding:4px 8px;font-size:12px}',
  '.dsb-u-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
  '.dsb-u-seg{display:flex;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:8px;overflow:hidden}',
  '.dsb-u-seg button{border:none;background:none;color:var(--dsw-alias-label-secondary,#667);font:inherit;font-size:12px;padding:4px 12px;cursor:pointer;line-height:1.4}',
  '.dsb-u-seg button:hover{background:var(--dsw-alias-border-l1,rgba(128,128,128,.15))}',
  '.dsb-u-seg button.dsb-u-on{background:var(--dsw-alias-bg-inplace,rgba(128,128,128,.2));color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}',
  '.dsb-u-dates{display:flex;align-items:center;gap:4px;margin-left:auto}',
  '.dsb-u-date{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:6px;background:none;color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:11px;padding:2px 4px}',
  '.dsb-u-tablewrap{max-height:min(420px,calc(100vh - 230px));overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:8px;margin-top:8px}',
  '.dsb-u-table{width:100%;border-collapse:collapse;font-size:12px}',
  '.dsb-u-table th{position:sticky;top:0;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.98));color:var(--dsw-alias-label-secondary,#667);font-weight:500;text-align:left;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));white-space:nowrap;z-index:1}',
  '.dsb-u-table td{padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12));vertical-align:middle}',
  '.dsb-u-table tr:last-child td{border-bottom:none}',
  '.dsb-u-table tbody tr:hover{background:var(--dsw-alias-border-l1,rgba(128,128,128,.1))}',
  '.dsb-u-time{white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary,#667)}',
  '.dsb-u-prompt{max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}',
  '.dsb-u-model{white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}',
  '.dsb-u-product{white-space:nowrap;color:var(--dsw-alias-label-secondary,#667)}',
  '.dsb-u-cost{white-space:nowrap;text-align:right;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:600}',
  '.dsb-u-foot{display:flex;justify-content:space-between;align-items:center;padding:6px 2px 0;color:var(--dsw-alias-label-secondary,#667);font-size:11px}',
  '.dsb-u-foot b{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary,#1f2328)}',
  '.dsb-u-empty{padding:28px 0;text-align:center;color:var(--dsw-alias-label-secondary,#667);font-size:12px}',
].join('');

function fmt(n, currency) { return (n === null || n === undefined || Number.isNaN(n)) ? '—' : (currency === 'USD' ? '$' : '¥') + Number(n).toFixed(2) }

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const styleEl = document.createElement('style')
  styleEl.textContent = CSS + USAGE_CSS
  document.head.appendChild(styleEl)
  ctx.effect(() => () => { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) })

  function PinIcon(props) {
    return React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: props.filled ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true', style: { display: 'block' } },
      React.createElement('path', { d: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z' }))
  }
  function MinusIcon() {
    return React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5, 'aria-hidden': 'true', style: { display: 'block' } },
      React.createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 }))
  }
  function RefreshIcon() {
    return React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, 'aria-hidden': 'true', style: { display: 'block' } },
      React.createElement('path', { d: 'M20 11A8 8 0 1 0 18.4 15', strokeLinecap: 'round' }),
      React.createElement('path', { d: 'M20 5v6h-6', strokeLinecap: 'round', strokeLinejoin: 'round' }))
  }
  function WarnIcon() {
    return React.createElement('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: '-1px', marginRight: 3 } },
      React.createElement('path', { d: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z' }))
  }

  // 用量明细视图：今天/7天/30天/自定义日期段筛选 + 轮级用量表格
  function UsageView() {
    const [preset, setPreset] = React.useState('7d')
    const [custom, setCustom] = React.useState({ from: '', to: '' })
    const [data, setData] = React.useState(null)

    // 计算查询窗口（本地时区）：预设按自然日；自定义单边缺省按 7 天窗口补齐，起止颠倒自动交换
    const range = React.useMemo(() => {
      const today0 = startOfDay(new Date())
      const end = today0 + DAY_MS
      if (preset === 'today') return { from: today0, to: end }
      if (preset === '30d') return { from: today0 - 29 * DAY_MS, to: end }
      if (preset === '7d') return { from: today0 - 6 * DAY_MS, to: end }
      const f = custom.from ? new Date(custom.from + 'T00:00:00').getTime() : null
      const t = custom.to ? new Date(custom.to + 'T00:00:00').getTime() + DAY_MS : null
      if (f && t) return f <= t ? { from: f, to: t } : { from: t - DAY_MS, to: f + DAY_MS }
      if (f) return { from: f, to: f + 7 * DAY_MS }
      if (t) return { from: t - 7 * DAY_MS, to: t }
      return { from: today0 - 6 * DAY_MS, to: end }
    }, [preset, custom.from, custom.to])

    React.useEffect(() => {
      let alive = true
      const load = () => {
        window.fetch(USAGE_URL + '?from=' + range.from + '&to=' + range.to)
          .then((r) => r.json())
          .then((d) => { if (alive) setData(d) })
          .catch(() => {})
      }
      load()
      const t = window.setInterval(load, 15000) // 明细打开期间每 15 秒跟随刷新
      return () => { alive = false; window.clearInterval(t) }
    }, [range.from, range.to])

    const currency = data ? data.currency : null
    const records = data && Array.isArray(data.records) ? data.records : []
    const label = fmtDay(range.from) + ' - ' + fmtDay(range.to - 1)
    const onDate = (key) => (e) => { const v = e.target.value; setCustom((c) => ({ ...c, [key]: v })); setPreset('custom') }

    return React.createElement('div', null,
      React.createElement('div', { className: 'dsb-u-filters' },
        React.createElement('div', { className: 'dsb-u-seg' },
          [['today', '今天'], ['7d', '7天'], ['30d', '30天']].map(([key, text]) =>
            React.createElement('button', { key: key, className: preset === key ? 'dsb-u-on' : '', onClick: () => setPreset(key) }, text))),
        React.createElement('span', { className: 'dsb-u-dates' },
          React.createElement('input', { type: 'date', className: 'dsb-u-date', value: custom.from, onChange: onDate('from'), title: '开始日期' }),
          React.createElement('span', null, '–'),
          React.createElement('input', { type: 'date', className: 'dsb-u-date', value: custom.to, onChange: onDate('to'), title: '结束日期' }))),
      records.length === 0
        ? React.createElement('div', { className: 'dsb-u-empty' }, '所选时间段暂无用量记录')
        : React.createElement('div', { className: 'dsb-u-tablewrap' },
            React.createElement('table', { className: 'dsb-u-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, '时间'),
                  React.createElement('th', null, '使用记录'),
                  React.createElement('th', null, '模型名称'),
                  React.createElement('th', null, '产品端'),
                  React.createElement('th', { style: { textAlign: 'right' } }, '花费'))),
              React.createElement('tbody', null,
                records.map((r, i) => React.createElement('tr', { key: (r.at || 0) + '-' + i },
                  React.createElement('td', { className: 'dsb-u-time' }, fmtTime(r.at)),
                  React.createElement('td', { className: 'dsb-u-prompt', title: r.prompt || '' }, r.prompt || '（非对话请求）'),
                  React.createElement('td', { className: 'dsb-u-model' }, r.model || 'unknown'),
                  React.createElement('td', { className: 'dsb-u-product' }, r.product || 'DSH'),
                  React.createElement('td', { className: 'dsb-u-cost' }, fmt(r.cost, currency))))))),
      React.createElement('div', { className: 'dsb-u-foot' },
        React.createElement('span', null, label + ' · 共 ' + records.length + ' 笔'),
        React.createElement('span', null, '合计 ', React.createElement('b', null, fmt(data ? data.total : null, currency)))))
  }

  function Panel() {
    const [snap, setSnap] = React.useState(null)
    const [collapsed, setCollapsed] = React.useState(false)
    const [view, setView] = React.useState('main') // 'main' 余额面板 | 'usage' 用量明细
    const [pos, setPos] = React.useState(null) // { side: 'left'|'right', top: number }
    const [pinned, setPinned] = React.useState(false)
    const [refreshing, setRefreshing] = React.useState(false)
    const panelRef = React.useRef(null)

    React.useEffect(() => {
      let alive = true
      let ws = null
      let unsub = null
      const sessionsSvc = ctx.get('sessions')
      const currentSessionId = () => {
        try {
          const list = sessionsSvc && sessionsSvc.list
          const snapshot = list ? list.getSnapshot() : null
          return snapshot ? snapshot.current : null
        } catch (e) { return null }
      }
      const buildUrl = (refresh) => {
        const sid = currentSessionId()
        const params = []
        if (refresh) params.push('refresh=1')
        if (sid) params.push('sessionId=' + encodeURIComponent(sid))
        return SNAPSHOT_URL + (params.length ? '?' + params.join('&') : '')
      }
      const load = (refresh) => window.fetch(buildUrl(refresh)).then((r) => r.json()).then((s) => { if (alive) setSnap(s) }).catch(() => {})
      const connectWS = () => {
        if (!alive) return
        try {
          const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
          ws = new WebSocket(proto + window.location.host + WS_URL)
          ws.onmessage = (ev) => {
            if (!alive) return
            try {
              const s = JSON.parse(ev.data)
              const current = currentSessionId()
              if (current && s.sessionId !== current) return
              setSnap(s)
            } catch (e) { /* 忽略坏帧 */ }
          }
          ws.onclose = () => { if (alive) window.setTimeout(connectWS, 3000) }
          ws.onerror = () => { try { ws.close() } catch (e) { /* 忽略 */ } }
        } catch (e) { ws = null }
      }
      load(false)
      connectWS()
      const t = window.setInterval(() => load(false), 15000)
      if (sessionsSvc && sessionsSvc.list && sessionsSvc.list.subscribe) {
        unsub = sessionsSvc.list.subscribe(() => { if (alive) load(false) })
      }
      return () => {
        alive = false
        window.clearInterval(t)
        if (unsub) unsub()
        if (ws) { try { ws.onclose = null; ws.close() } catch (e) { /* 忽略 */ } }
      }
    }, [])

    function refreshNow() {
      if (refreshing) return
      setRefreshing(true)
      let sid = null
      try {
        const sessionsSvc = ctx.get('sessions')
        const list = sessionsSvc && sessionsSvc.list
        const snapshot = list ? list.getSnapshot() : null
        sid = snapshot ? snapshot.current : null
      } catch (e) { /* 忽略 */ }
      const params = ['refresh=1']
      if (sid) params.push('sessionId=' + encodeURIComponent(sid))
      window.fetch(SNAPSHOT_URL + '?' + params.join('&')).then((r) => r.json()).then((s) => setSnap(s)).catch(() => {}).finally(() => setRefreshing(false))
    }

    function startDrag(e) {
      if (e.target && e.target.closest && e.target.closest('button')) return
      const el = panelRef.current
      if (!el) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const startX = e.clientX, startY = e.clientY, startLeft = rect.left, startTop = rect.top
      let moved = false
      const move = (ev) => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 5) moved = true
        if (!moved) return
        const left = Math.min(Math.max(0, startLeft + ev.clientX - startX), window.innerWidth - rect.width)
        const top = Math.min(Math.max(0, startTop + ev.clientY - startY), window.innerHeight - rect.height)
        el.style.left = left + 'px'
        el.style.top = top + 'px'
        el.style.right = 'auto'
      }
      const up = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        if (!moved) {
          if (collapsed) setCollapsed(false)
          return
        }
        const el2 = panelRef.current
        const r = el2 ? el2.getBoundingClientRect() : rect
        const side = r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right'
        const top = Math.min(Math.max(0, r.top), window.innerHeight - 48)
        setPos({ side, top })
        if (!pinned) setCollapsed(true)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    }

    const current = snap ? snap.current : null
    const last = snap ? snap.last : null
    const spent = snap ? snap.spent : null
    const lastTurnCost = snap ? snap.lastTurnCost : null
    const start = snap ? snap.dialogStartBalance : null
    const error = snap ? snap.error : null
    const low = current !== null && current < 2
    const style = pos ? (pos.side === 'left'
      ? { left: '8px', right: 'auto', top: pos.top + 'px' }
      : { left: 'auto', right: '8px', top: pos.top + 'px' }) : null

    if (collapsed) {
      return React.createElement('div', { ref: panelRef, className: 'dsb-cap' + (low ? ' dsb-cap-low' : ''), style, onPointerDown: pinned ? undefined : startDrag, onClick: () => setCollapsed(false), title: pinned ? '已固定，点击展开' : '点击展开，拖动可移动' },
        fmt(current, snap && snap.currency))
    }

    const isUsage = view === 'usage'
    return React.createElement('div', { ref: panelRef, className: 'dsb-panel' + (low ? ' dsb-panel-low' : '') + (isUsage ? ' dsb-panel-usage' : ''), style, onPointerDown: startDrag },
      React.createElement('div', { className: 'dsb-head' },
        React.createElement('span', { className: 'dsb-title' }, isUsage ? '用量明细' : 'DeepSeek 余额'),
        React.createElement('span', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
          React.createElement('button', { className: 'dsb-btn dsb-btn-txt', title: isUsage ? '返回余额' : '查看用量明细', onClick: () => setView(isUsage ? 'main' : 'usage') }, isUsage ? '返回' : '更多'),
          isUsage ? null : React.createElement('button', { className: 'dsb-btn', title: '刷新余额', onClick: refreshNow, style: refreshing ? { opacity: 0.5 } : undefined }, React.createElement(RefreshIcon)),
          React.createElement('button', { className: 'dsb-btn', title: pinned ? '取消固定' : '固定大小（拖到边不自动最小化）', onClick: () => setPinned(!pinned) }, React.createElement(PinIcon, { filled: pinned })),
          pinned ? null : React.createElement('button', { className: 'dsb-btn', title: '收起', onClick: () => setCollapsed(true) }, React.createElement(MinusIcon)))),
      React.createElement('div', { className: 'dsb-body' },
        isUsage ? React.createElement(UsageView) : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'dsb-row dsb-cur' },
            React.createElement('span', { className: 'dsb-label' }, '余额'),
            React.createElement('span', { className: 'dsb-cur-num' }, fmt(current, snap && snap.currency))),
          React.createElement('div', { className: 'dsb-row' },
            React.createElement('span', null, '对话框开始余额'),
            React.createElement('b', null, fmt(start, snap && snap.currency))),
          React.createElement('div', { className: 'dsb-row' },
            React.createElement('span', null, '上次对话余额'),
            React.createElement('b', null, fmt(last, snap && snap.currency))),
          React.createElement('div', { className: 'dsb-row' },
            React.createElement('span', null, '上轮花费'),
            React.createElement('b', null, fmt(lastTurnCost, snap && snap.currency))),
          React.createElement('div', { className: 'dsb-row' },
            React.createElement('span', null, '本轮已花费'),
            React.createElement('b', null, fmt(spent, snap && snap.currency))),
          error ? React.createElement('div', { className: 'dsb-err', title: error }, React.createElement(WarnIcon), '余额获取失败（悬停看原因）') : null)))
  }

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'deepseek-billing-panel', order: 0 },
    () => React.createElement(Panel),
  ))
  console.log('[deepseek-billing] client slot registered')
}
return module.exports; } });
