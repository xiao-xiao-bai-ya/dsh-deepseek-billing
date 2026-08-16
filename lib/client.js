window.__ModuleLoader__.load({ id: "@dsh-external/dsh-deepseek-billing", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const React = require("react");
const SNAPSHOT_URL = '/_dsh/deepseek-billing/snapshot';
const WS_URL = '/_dsh/deepseek-billing/ws';

const CSS = '.dsb-panel{position:fixed;top:64px;right:16px;z-index:99990;width:224px;pointer-events:auto;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.95));color:var(--dsw-alias-label-primary,#1f2328);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.16);font-size:13px;line-height:1.5;user-select:none;cursor:grab;backdrop-filter:blur(10px)}.dsb-panel:active{cursor:grabbing}.dsb-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 6px}.dsb-title{font-weight:600}.dsb-btn{cursor:pointer;border:none;background:none;color:var(--dsw-alias-label-secondary,#667);font:inherit;padding:4px 6px;line-height:1;min-width:26px;min-height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px}.dsb-btn:hover{background:var(--dsw-alias-border-l1,rgba(128,128,128,.15))}.dsb-body{padding:0 10px 10px;display:flex;flex-direction:column;gap:6px}.dsb-row{display:flex;justify-content:space-between;align-items:baseline}.dsb-row b{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:600}.dsb-cur{border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));padding-bottom:6px}.dsb-label{color:var(--dsw-alias-label-secondary,#667)}.dsb-cur-num{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:24px;font-weight:700}.dsb-panel-low .dsb-cur-num,.dsb-panel-low b{color:var(--dsw-alias-state-error-primary,#cf222e)}.dsb-err{color:var(--dsw-alias-state-error-primary,#cf222e);font-size:11px;cursor:help}.dsb-cap{position:fixed;top:64px;right:16px;z-index:99990;pointer-events:auto;display:inline-block;width:fit-content;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.95));color:var(--dsw-alias-label-primary,#1f2328);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.16);padding:5px 14px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700;cursor:grab;user-select:none;backdrop-filter:blur(10px)}.dsb-cap-low{color:var(--dsw-alias-state-error-primary,#cf222e)}';

function fmt(n, currency) { return (n === null || n === undefined || Number.isNaN(n)) ? '—' : (currency === 'USD' ? '$' : '¥') + Number(n).toFixed(2) }

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const styleEl = document.createElement('style')
  styleEl.textContent = CSS
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

  function Panel() {
    const [snap, setSnap] = React.useState(null)
    const [collapsed, setCollapsed] = React.useState(false)
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

    return React.createElement('div', { ref: panelRef, className: 'dsb-panel' + (low ? ' dsb-panel-low' : ''), style, onPointerDown: startDrag },
      React.createElement('div', { className: 'dsb-head' },
        React.createElement('span', { className: 'dsb-title' }, 'DeepSeek 余额'),
        React.createElement('span', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
          React.createElement('button', { className: 'dsb-btn', title: '刷新余额', onClick: refreshNow, style: refreshing ? { opacity: 0.5 } : undefined }, React.createElement(RefreshIcon)),
          React.createElement('button', { className: 'dsb-btn', title: pinned ? '取消固定' : '固定大小（拖到边不自动最小化）', onClick: () => setPinned(!pinned) }, React.createElement(PinIcon, { filled: pinned })),
          pinned ? null : React.createElement('button', { className: 'dsb-btn', title: '收起', onClick: () => setCollapsed(true) }, React.createElement(MinusIcon)))),
      React.createElement('div', { className: 'dsb-body' },
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
        error ? React.createElement('div', { className: 'dsb-err', title: error }, React.createElement(WarnIcon), '余额获取失败（悬停看原因）') : null))
  }

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'deepseek-billing-panel', order: 0 },
    () => React.createElement(Panel),
  ))
  console.log('[deepseek-billing] client slot registered')
}
return module.exports; } });
