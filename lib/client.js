window.__ModuleLoader__.load({ id: "@dsh-external/dsh-deepseek-billing", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.name = '@dsh-external/dsh-deepseek-billing'
exports.inject = ['slots', 'locale']
exports.apply = apply;
const React = require("react");
const SNAPSHOT_URL = '/_dsh/deepseek-billing/snapshot';
const WS_URL = '/_dsh/deepseek-billing/ws';
const USAGE_URL = '/_dsh/deepseek-billing/usage';
const DAY_MS = 24 * 3600 * 1000;

// 8.9 i18n dict（zh/en）：UI 字符串集中管理，缺席 locale 或未知 key 降级内置 zh
const I18N = {
  zh: {
    title: '计费面板',
    usageTitle: '用量明细',
    back: '返回',
    more: '更多',
    backBalance: '返回余额',
    viewUsage: '查看用量明细',
    refreshBalance: '刷新余额',
    unpin: '取消固定',
    pin: '固定大小（拖到边不自动最小化）',
    collapse: '收起',
    pinnedTitle: '已固定，点击展开',
    dragTitle: '点击展开，拖动可移动',
    balanceLabel: 'DeepSeek 平台余额',
    noBalanceHint: 'GLM 等第三方平台无官方余额接口，仅支持 DeepSeek 平台查询',
    dialogStartBalance: '对话框开始余额',
    lastTurnCost: '上轮花费',
    lastBalance: '上次对话余额',
    thisTurnCost: '本轮已花费',
    fetchError: '余额获取失败（悬停看原因）',
    today: '今天',
    days7: '7天',
    days30: '30天',
    startDate: '开始日期',
    endDate: '结束日期',
    noRecords: '所选时间段暂无用量记录',
    time: '时间',
    usageRecord: '使用记录',
    modelName: '模型名称',
    product: '产品端',
    cost: '花费',
    nonConversation: '（非对话请求）',
    nonDeepseekCost: '非 DeepSeek 模型（如 GLM），暂无价目表，未计费',
    total: '合计',
    count: ' 共 {n} 笔',
  },
  en: {
    title: 'Billing Panel',
    usageTitle: 'Usage Details',
    back: 'Back',
    more: 'More',
    backBalance: 'Back to Balance',
    viewUsage: 'View Usage',
    refreshBalance: 'Refresh Balance',
    unpin: 'Unpin',
    pin: 'Pin (no auto-collapse)',
    collapse: 'Collapse',
    pinnedTitle: 'Pinned, click to expand',
    dragTitle: 'Click to expand, drag to move',
    balanceLabel: 'DeepSeek Platform Balance',
    noBalanceHint: 'Third-party platforms have no official balance API',
    dialogStartBalance: 'Dialog Start Balance',
    lastTurnCost: 'Last Turn Cost',
    lastBalance: 'Last Balance',
    thisTurnCost: 'This Turn Cost',
    fetchError: 'Balance fetch failed (hover for reason)',
    today: 'Today',
    days7: '7 Days',
    days30: '30 Days',
    startDate: 'Start Date',
    endDate: 'End Date',
    noRecords: 'No usage records',
    time: 'Time',
    usageRecord: 'Usage Record',
    modelName: 'Model Name',
    product: 'Product',
    cost: 'Cost',
    nonConversation: '(Non-conversation)',
    nonDeepseekCost: 'Non-DeepSeek model, no pricing table',
    total: 'Total',
    count: ' {n} records',
  },
}

function pad2(n) { return String(n).padStart(2, '0') }
function fmtDay(ts) { const d = new Date(ts); return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) }
function fmtTime(ts) { const d = new Date(ts); return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }

// 金额自适应精度：正常 2 位；0 < |n| < 0.01 的零钱按 4 位显示（流式计价常见小额）
function fmt(n, currency) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const sym = currency === 'USD' ? '$' : '¥'
  const v = Number(n)
  const dec = Math.abs(v) > 0 && Math.abs(v) < 0.01 ? 4 : 2
  return sym + v.toFixed(dec)
}

// 主面板样式：对齐 DSH 深色设置页风格（深底/发丝线/圆角/药丸按钮）
const CSS = [
  '.dsb-panel{position:fixed;top:64px;right:16px;z-index:99990;width:256px;pointer-events:auto;background:var(--dsw-alias-bg-overlay,#242427);color:var(--dsw-alias-label-primary,#ececec);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.11));border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.42);font-size:13px;line-height:1.5;user-select:none;cursor:grab;backdrop-filter:blur(14px);overflow:hidden}',
  '.dsb-panel:active{cursor:grabbing}',
  '.dsb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:10px 12px 9px;border-bottom:1px solid rgba(128,128,128,.16)}',
  '.dsb-title{font-weight:600;font-size:13px;letter-spacing:.2px}',
  '.dsb-sub{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsb-actions{display:flex;gap:2px;align-items:center;flex-shrink:0;margin:-2px -4px 0 0}',
  '.dsb-btn{cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);font:inherit;padding:4px 6px;line-height:1;min-width:26px;min-height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;transition:background .12s ease,color .12s ease}',
  '.dsb-btn:hover{background:rgba(128,128,128,.2);color:var(--dsw-alias-label-primary,#ececec)}',
  '.dsb-btn-txt{min-width:0;padding:4px 8px;font-size:12px}',
  '.dsb-hero{padding:12px 14px 11px}',
  '.dsb-hero-label{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a)}',
  '.dsb-hero-num{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:26px;font-weight:700;line-height:1.25;margin-top:2px}',
  '.dsb-hero-hint{margin-top:5px;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary,#9a9a9a)}',
  '.dsb-panel-low .dsb-hero-num{color:var(--dsw-alias-state-error-primary,#f87171)}',
  '.dsb-grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid rgba(128,128,128,.16)}',
  '.dsb-cell{padding:8px 14px 9px;min-width:0}',
  '.dsb-cell:nth-child(n+3){border-top:1px solid rgba(128,128,128,.11)}',
  '.dsb-cell:nth-child(odd){border-right:1px solid rgba(128,128,128,.11)}',
  '.dsb-cell-label{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);white-space:nowrap}',
  '.dsb-cell-value{margin-top:1px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis}',
  '.dsb-cell-live .dsb-cell-value{color:#34d399}',
  '.dsb-err{display:flex;align-items:center;gap:4px;padding:7px 14px;border-top:1px solid rgba(128,128,128,.16);color:var(--dsw-alias-state-error-primary,#f87171);font-size:11px;cursor:help}',
  '.dsb-cap{position:fixed;top:64px;right:16px;z-index:99990;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;width:fit-content;background:var(--dsw-alias-bg-overlay,#242427);color:var(--dsw-alias-label-primary,#ececec);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.11));border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.38);padding:6px 15px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:600;cursor:pointer;backdrop-filter:blur(14px);transition:transform .12s ease,box-shadow .12s ease}',
  '.dsb-cap:hover{transform:translateY(-1px);box-shadow:0 8px 26px rgba(0,0,0,.5)}',
  '.dsb-cap-low{color:var(--dsw-alias-state-error-primary,#f87171)}',
].join('')

// 用量明细视图样式（数组 join 便于逐行维护）
const USAGE_CSS = [
  '/* ---- 用量明细视图 ---- */',
  '.dsb-panel.dsb-panel-usage{width:620px;max-width:calc(100vw - 24px)}',
  '.dsb-u-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid rgba(128,128,128,.16)}',
  '.dsb-u-seg{display:flex;border:1px solid rgba(128,128,128,.26);border-radius:7px;overflow:hidden}',
  '.dsb-u-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);font:inherit;font-size:11px;padding:3px 10px;cursor:pointer;line-height:1.4;transition:background .12s ease,color .12s ease}',
  '.dsb-u-seg button:hover{background:rgba(128,128,128,.16);color:var(--dsw-alias-label-primary,#ececec)}',
  '.dsb-u-seg button.dsb-u-on{background:rgba(128,128,128,.24);color:var(--dsw-alias-label-primary,#ececec);font-weight:600}',
  '.dsb-u-dates{display:flex;align-items:center;gap:4px;margin-left:auto;color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:10px}',
  '.dsb-u-date{border:1px solid rgba(128,128,128,.26);border-radius:5px;background:var(--dsw-alias-bg-inplace,#1d1d20);color:var(--dsw-alias-label-primary,#ececec);font:inherit;font-size:10px;padding:2px 4px;color-scheme:dark}',
  '.dsb-u-tablewrap{max-height:min(420px,calc(100vh - 210px));overflow-x:hidden;overflow-y:auto;margin:8px 10px 4px;border:1px solid rgba(128,128,128,.16);border-radius:10px}',
  '.dsb-u-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:11px}',
  '.dsb-u-table th{position:sticky;top:0;background:var(--dsw-alias-bg-overlay,#2b2b2f);color:var(--dsw-alias-label-secondary,#9a9a9a);font-weight:500;text-align:left;padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.2);white-space:nowrap;z-index:1}',
  '.dsb-u-table td{padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.08);vertical-align:middle}',
  '.dsb-u-table th:nth-child(1),.dsb-u-table td:nth-child(1){width:18%}',
  '.dsb-u-table th:nth-child(2),.dsb-u-table td:nth-child(2){width:34%}',
  '.dsb-u-table th:nth-child(3),.dsb-u-table td:nth-child(3){width:24%}',
  '.dsb-u-table th:nth-child(4),.dsb-u-table td:nth-child(4){width:12%}',
  '.dsb-u-table th:nth-child(5),.dsb-u-table td:nth-child(5){width:12%}',
  '.dsb-u-table tr:last-child td{border-bottom:none}',
  '.dsb-u-table tbody tr:hover{background:rgba(128,128,128,.09)}',
  '.dsb-u-time{white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:10px}',
  '.dsb-u-prompt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}',
  '.dsb-u-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}',
  '.dsb-u-product{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#9a9a9a)}',
  '.dsb-u-cost{white-space:nowrap;text-align:right;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:600}',
  '.dsb-u-foot{display:flex;justify-content:space-between;align-items:center;padding:6px 10px 10px;color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11px}',
  '.dsb-u-foot b{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary,#ececec)}',
  '.dsb-u-empty{padding:24px 0;text-align:center;color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:12px}',
].join('')

// 模型/提供方 id → 显示名（catalog 由 host 从 llm 服务 + settings.yaml 构建）。
// 记录里多模型按 ' + ' 拼接，逐段映射；查不到就回退原 id。
function modelLabel(raw, providerRaw, catalog) {
  if (!raw) return 'unknown'
  const parts = String(raw).split(' + ')
  const provParts = String(providerRaw || '').split(' + ')
  const models = catalog && catalog.models ? catalog.models : null
  if (!models) return String(raw)
  return parts.map((m, i) => {
    const pmap = models[provParts[i]]
    if (pmap && pmap[m]) return pmap[m]
    for (const pid in models) { if (models[pid] && models[pid][m]) return models[pid][m] }
    return m
  }).join(' + ')
}
function providerLabel(raw, catalog) {
  const providers = catalog && catalog.providers ? catalog.providers : null
  if (!providers) return String(raw || 'DSH')
  return String(raw || 'DSH').split(' + ').map((p) => providers[p] || p).join(' + ')
}

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const styleEl = document.createElement('style')
  styleEl.textContent = CSS + USAGE_CSS
  document.head.appendChild(styleEl)
  ctx.effect(() => () => { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) })

  // 8.9 解析 locale：短服务名 'locale'（对齐 dsh-chat-import / dsh-client-ui-sidebar），
  // 缺席降级内置 zh。LocaleRuntime.getLocale().active 形如 'zh-CN' / 'en'。
  let locale = 'zh'
  try {
    const localeSvc = ctx.get('locale')
    if (localeSvc && typeof localeSvc.getLocale === 'function') {
      const active = localeSvc.getLocale().active
      if (active) locale = String(active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }
  } catch (e) { /* 忽略 */ }
  const t = (key) => (I18N[locale] || I18N['zh'])[key] || key

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
    const catalog = data ? data.catalog : null
    const records = data && Array.isArray(data.records) ? data.records : []
    const label = fmtDay(range.from) + ' - ' + fmtDay(range.to - 1)
    const onDate = (key) => (e) => { const v = e.target.value; setCustom((c) => ({ ...c, [key]: v })); setPreset('custom') }

    return React.createElement('div', null,
      React.createElement('div', { className: 'dsb-u-filters' },
        React.createElement('div', { className: 'dsb-u-seg' },
          [['today', t('today')], ['7d', t('days7')], ['30d', t('days30')]].map(([key, text]) =>
            React.createElement('button', { key: key, className: preset === key ? 'dsb-u-on' : '', onClick: () => setPreset(key) }, text))),
        React.createElement('span', { className: 'dsb-u-dates' },
          React.createElement('input', { type: 'date', className: 'dsb-u-date', value: custom.from, onChange: onDate('from'), title: t('startDate') }),
          React.createElement('span', null, '–'),
          React.createElement('input', { type: 'date', className: 'dsb-u-date', value: custom.to, onChange: onDate('to'), title: t('endDate') }))),
      records.length === 0
        ? React.createElement('div', { className: 'dsb-u-empty' }, t('noRecords'))
        : React.createElement('div', { className: 'dsb-u-tablewrap' },
            React.createElement('table', { className: 'dsb-u-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, t('time')),
                  React.createElement('th', null, t('usageRecord')),
                  React.createElement('th', null, t('modelName')),
                  React.createElement('th', null, t('product')),
                  React.createElement('th', { style: { textAlign: 'right' } }, t('cost')))),
              React.createElement('tbody', null,
                records.map((r, i) => React.createElement('tr', { key: (r.at || 0) + '-' + i },
                  React.createElement('td', { className: 'dsb-u-time' }, fmtTime(r.at)),
                  React.createElement('td', { className: 'dsb-u-prompt', title: r.prompt || '' }, r.prompt || t('nonConversation')),
                  React.createElement('td', { className: 'dsb-u-model', title: r.model || '' }, modelLabel(r.model, r.provider, catalog)),
                  React.createElement('td', { className: 'dsb-u-product', title: r.provider || '' }, providerLabel(r.provider || r.product, catalog)),
                  React.createElement('td', { className: 'dsb-u-cost', title: r.cost == null ? t('nonDeepseekCost') : '' }, fmt(r.cost, currency))))))),
      React.createElement('div', { className: 'dsb-u-foot' },
        React.createElement('span', null, label + t('count').replace('{n}', records.length)),
        React.createElement('span', null, t('total') + ' ', React.createElement('b', null, fmt(data ? data.total : null, currency)))))
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
      // WS 推送帧不带 catalog，合并时保留上一份目录
      const mergeSnap = (s) => setSnap((prev) => (s.catalog || !prev) ? s : { ...s, catalog: prev.catalog })
      const load = (refresh) => window.fetch(buildUrl(refresh)).then((r) => r.json()).then((s) => { if (alive) mergeSnap(s) }).catch(() => {})
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
              mergeSnap(s)
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
      window.fetch(SNAPSHOT_URL + '?' + params.join('&')).then((r) => r.json()).then((s) => setSnap((prev) => (s.catalog || !prev) ? s : { ...s, catalog: prev.catalog })).catch(() => {}).finally(() => setRefreshing(false))
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

    const currency = snap ? snap.currency : null
    const current = snap ? snap.current : null
    const last = snap ? snap.last : null
    const spent = snap ? snap.spent : null
    const lastTurnCost = snap ? snap.lastTurnCost : null
    const start = snap ? snap.dialogStartBalance : null
    const error = snap ? snap.error : null
    const catalog = snap ? snap.catalog : null
    const low = current !== null && current < 2
    const style = pos ? (pos.side === 'left'
      ? { left: '8px', right: 'auto', top: pos.top + 'px' }
      : { left: 'auto', right: '8px', top: pos.top + 'px' }) : null

    // 当前默认模型（来自 settings.yaml 的 agent-default-model），显示为头部副标题
    const dm = catalog ? catalog.defaultModel : null
    const dmProvider = dm ? providerLabel(dm.provider, catalog) : null
    const dmModel = dm ? modelLabel(dm.model, dm.provider, catalog) : null
    const subText = dm ? [dmProvider, dmModel].filter(Boolean).join(' · ') : null

    if (collapsed) {
      return React.createElement('div', { ref: panelRef, className: 'dsb-cap' + (low ? ' dsb-cap-low' : ''), style, onPointerDown: pinned ? undefined : startDrag, onClick: () => setCollapsed(false), title: pinned ? t('pinnedTitle') : t('dragTitle') },
        fmt(current, currency))
    }

    const isUsage = view === 'usage'
    return React.createElement('div', { ref: panelRef, className: 'dsb-panel' + (low ? ' dsb-panel-low' : '') + (isUsage ? ' dsb-panel-usage' : ''), style, onPointerDown: startDrag },
      React.createElement('div', { className: 'dsb-head' },
        React.createElement('div', null,
          React.createElement('div', { className: 'dsb-title' }, isUsage ? t('usageTitle') : t('title')),
          (!isUsage && subText) ? React.createElement('div', { className: 'dsb-sub', title: subText }, subText) : null),
        React.createElement('div', { className: 'dsb-actions' },
          React.createElement('button', { className: 'dsb-btn dsb-btn-txt', title: isUsage ? t('backBalance') : t('viewUsage'), onClick: () => setView(isUsage ? 'main' : 'usage') }, isUsage ? t('back') : t('more')),
          isUsage ? null : React.createElement('button', { className: 'dsb-btn', title: t('refreshBalance'), onClick: refreshNow, style: refreshing ? { opacity: 0.5 } : undefined }, React.createElement(RefreshIcon)),
          React.createElement('button', { className: 'dsb-btn', title: pinned ? t('unpin') : t('pin'), onClick: () => setPinned(!pinned) }, React.createElement(PinIcon, { filled: pinned })),
          pinned ? null : React.createElement('button', { className: 'dsb-btn', title: t('collapse'), onClick: () => setCollapsed(true) }, React.createElement(MinusIcon)))),
      React.createElement('div', { className: 'dsb-body' },
        isUsage ? React.createElement(UsageView) : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'dsb-hero' },
            React.createElement('div', { className: 'dsb-hero-label' }, t('balanceLabel')),
            React.createElement('div', { className: 'dsb-hero-num' }, fmt(current, currency)),
            current === null && !error
              ? React.createElement('div', { className: 'dsb-hero-hint' }, t('noBalanceHint'))
              : null),
          React.createElement('div', { className: 'dsb-grid' },
            React.createElement('div', { className: 'dsb-cell' },
              React.createElement('div', { className: 'dsb-cell-label' }, t('dialogStartBalance')),
              React.createElement('div', { className: 'dsb-cell-value' }, fmt(start, currency))),
            React.createElement('div', { className: 'dsb-cell' },
              React.createElement('div', { className: 'dsb-cell-label' }, t('lastTurnCost')),
              React.createElement('div', { className: 'dsb-cell-value' }, fmt(lastTurnCost, currency))),
            React.createElement('div', { className: 'dsb-cell' },
              React.createElement('div', { className: 'dsb-cell-label' }, t('lastBalance')),
              React.createElement('div', { className: 'dsb-cell-value' }, fmt(last, currency))),
            React.createElement('div', { className: 'dsb-cell' + (spent > 0 ? ' dsb-cell-live' : '') },
              React.createElement('div', { className: 'dsb-cell-label' }, t('thisTurnCost')),
              React.createElement('div', { className: 'dsb-cell-value' }, fmt(spent, currency)))),
          error ? React.createElement('div', { className: 'dsb-err', title: error }, React.createElement(WarnIcon), t('fetchError')) : null)))
  }

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'deepseek-billing-panel', order: 0 },
    () => React.createElement(Panel),
  ))
  console.log('[deepseek-billing] client slot registered')
}
return module.exports; } }); // 8.9 client bundle completed: name/inject + zh/en i18n dict + locale fallback
