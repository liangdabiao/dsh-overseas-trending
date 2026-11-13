// 海外跨平台热文搜索 · 面板逻辑：概览（搜索表单+历史）/ 详情页（平台状态统计 + HTML 报告内嵌）/ 设置。
// 「去对话深挖」走 agent：嵌入 dsh → postMessage（client.js startSession，有 start-ok 握手）。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')
  const EMBEDDED = (() => { try { return window.parent !== window } catch { return false } })()

  const state = { catalog: null }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  async function api(path) {
    const res = await fetch(`/overseas-trending${path}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return body
  }
  async function apiPost(path, payload) {
    const res = await fetch(`/overseas-trending${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }
  async function apiDelete(path) {
    const res = await fetch(`/overseas-trending${path}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  // 打开外部链接：桌面端 iframe 里 window.open 会被 WebContentsView deny，
  // 先请宿主用系统默认浏览器打开；宿主不支持（网页版/无桌面）时退回新窗口。
  async function openLink(u) {
    if (!u || u === '#' || u === 'about:blank') return
    try {
      const r = await apiPost('/api/open', { url: u })
      if (r?.ok) { toast('已在系统浏览器打开'); return }
      throw new Error(r?.error || '打开失败')
    } catch (e) {
      const win = window.open(u, '_blank', 'noopener')
      if (!win) {
        const hint = /404|not found/i.test(String(e.message))
          ? '宿主还没重启（/api/open 未上线），重启 dsh 后就能用系统浏览器打开'
          : e.message
        toast(`链接打不开：${hint}`, true)
      }
    }
  }

  // 面板里的外链一律交给系统浏览器（桌面端 <a target="_blank"> 同样会被 deny）
  function bindExternalLinks() {
    document.querySelectorAll('a[target="_blank"]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openLink(a.getAttribute('href')) }
    })
  }

  let toastTimer = null
  function toast(msg, isErr) {
    $toast.textContent = msg
    $toast.className = `toast show${isErr ? ' err' : ''}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { $toast.className = 'toast' }, 3200)
  }
  function copyFallback(prompt, reason) {
    navigator.clipboard?.writeText(prompt).then(
      () => toast(`${reason}，草稿已复制到剪贴板——请粘贴到 dsh 对话`, true),
      () => toast(`${reason}，复制也失败了`, true))
  }

  const ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 .33-1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v5H5V6h5"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
  }
  const ic = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`

  const PF_META = {
    x: { label: 'X', color: '#536471' },
    tiktok: { label: 'TikTok', color: '#fe2c55' },
    youtube: { label: 'YouTube', color: '#ff0000' },
  }

  async function loadCatalog() {
    state.catalog = await api('/api/catalog')
    renderNavCounts()
    renderRailFoot()
    return state.catalog
  }
  function renderNavCounts() {
    const c = state.catalog
    if (!c) return
    document.querySelectorAll('[data-count]').forEach((n) => {
      if (n.dataset.count === 'searches') n.textContent = (c.searches || []).length
    })
  }
  function renderRailFoot() {
    const c = state.catalog
    if (!c) return
    const latest = (c.searches || [])[0]
    document.getElementById('rail-foot').innerHTML =
      `<div class="v-head">OVERSEAS RADAR v${esc(c.version)}</div>` +
      `<div class="v-row"><span>API Key</span><span>${c.has_key ? '已配置' : '未配置'}</span></div>` +
      `<div class="v-row"><span>搜索数</span><span>${(c.searches || []).length}</span></div>` +
      `<div class="v-row"><span>最近搜索</span><span>${esc(latest?.keyword_label || '—')}</span></div>`
  }

  // ---------- 送 prompt 到 agent 对话 ----------
  function sendAgentPrompt(prompt, okMsg = '已在宿主开新对话——agent 处理中') {
    if (!EMBEDDED) {
      navigator.clipboard?.writeText(prompt).then(
        () => toast('草稿已复制——粘贴到 dsh 对话即可开始'),
        () => copyFallback(prompt, '复制失败'))
      return
    }
    let done = false
    const cleanup = () => { done = true; clearTimeout(timer); removeEventListener('message', onMsg) }
    const onMsg = (e) => {
      if (e.origin !== location.origin) return
      if (e.data?.type === 'overseas-trending:start-ok') { if (!done) { cleanup(); toast(okMsg) } }
      else if (e.data?.type === 'overseas-trending:start-failed') { if (!done) { cleanup(); toast(`没能开新对话：${e.data.message || ''}`, true) } }
    }
    const timer = setTimeout(() => { if (!done) { cleanup(); copyFallback(prompt, '未收到宿主确认') } }, 1500)
    addEventListener('message', onMsg)
    parent.postMessage({ type: 'overseas-trending:refresh', prompt }, location.origin)
  }

  function digPrompt(search) {
    return [
      `请深挖海外跨平台热文搜索「${search.keyword_label}」（记录 ${search.search_id}）：`,
      `1. overseas_search(action="get", searchId="${search.search_id}") 补读全部条目`,
      '2. 跨平台对比解读：X 偏观点讨论、TikTok 偏短视频传播、YouTube 偏深度内容；语言分层判断话题在不同语言市场的渗透度',
      '3. 需要延伸搜索时提醒用户每次搜索消耗较多积分（YouTube 详情补全），确认后再搜。引用一律内联链接，末尾附页脚。',
    ].join('\n')
  }

  // ---------- 视图：概览 ----------
  function viewHome() {
    const c = state.catalog
    const searches = c.searches || []
    const pfChecks = (c.platforms || []).map((p) =>
      `<label><input type="checkbox" name="pf" value="${esc(p)}" checked>${esc(PF_META[p]?.label || p)}</label>`).join('')
    const sortOptions = Object.entries(c.sort_options || {}).map(([k, label]) =>
      `<option value="${esc(k)}"${k === 'views' ? ' selected' : ''}>${esc(label)}</option>`).join('')
    return `
      <header class="head">
        <span class="eyebrow">OVERSEAS TRENDING</span>
        <div class="head-row">
          <h1>海外跨平台<strong>热文搜索</strong></h1>
        </div>
        <p>输入关键词（中英文均可）一次搜索 X / TikTok / YouTube 三平台热门内容：每平台 Top N 统一列表，语言优先分层（中文词优先中文内容），深色主题 HTML 报告（卡片/表格双视图）。<strong>积分提示</strong>：YouTube 点赞/评论需逐条补全详情，一次三平台搜索约 23+ 次接口调用。RedFox API Key ${c.has_key ? '已配置' : '未配置——去「设置」页填写'}。</p>
      </header>
      ${!c.has_key ? `<div class="empty" style="margin-bottom:var(--sp-6);padding:var(--sp-4) var(--sp-5);text-align:left"><div class="e-title">🔑 还没有配置 RedFox API Key</div><p>到<a href="#/settings">「设置」</a>页填写（ak_ 开头，<a href="https://redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">红狐 hub 获取 ↗</a>）。</p></div>` : ''}
      <section class="sec" style="margin-top:0">
        <div class="sec-head"><span class="num">01</span><h2>跨平台搜索</h2></div>
        <div class="form" style="max-width:760px">
          <div class="field"><label>KEYWORDS · 关键词（中英文均可，多词英文逗号分隔）</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="f-kw" placeholder="如：AI agent / 人工智能 / 新能源,EV" style="flex:1;min-width:220px">
              <button class="btn accent" id="f-go">${ic('play')}搜索三平台</button>
            </div>
          </div>
          <div class="field"><label>PLATFORMS · 平台</label><div class="checks">${pfChecks}</div></div>
          <div class="form-row">
            <div class="field"><label>DAYS · 时间窗口（TikTok 热门多为历史内容，建议放宽）</label>
              <select id="f-days"><option value="1">最近 1 天</option><option value="3">最近 3 天</option><option value="7" selected>最近 7 天</option><option value="30">最近 30 天</option><option value="0">不限</option></select></div>
            <div class="field"><label>SORT · 排序指标</label>
              <select id="f-sort">${sortOptions}</select></div>
          </div>
          <div class="form-row">
            <div class="field"><label>TOP · 每平台条数（0=不限）</label>
              <select id="f-top"><option value="5" selected>5</option><option value="10">10</option><option value="20">20</option></select></div>
            <div class="field"><label>DETAIL TOP · YouTube 详情补全条数（调小省积分）</label>
              <select id="f-detail"><option value="0">0</option><option value="5" selected>5</option><option value="10">10</option><option value="20">20</option></select></div>
          </div>
          <div class="hint" id="f-status"></div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><span class="num">02</span><h2>搜索历史</h2></div>
        ${searches.length ? `<div class="cards">${searches.map((r) => `
          <a class="card" href="#/s/${encodeURIComponent(r.search_id)}">
            <div class="c-top">
              <div class="c-title">${esc(r.keyword_label)}</div>
              ${r.has_report ? '<span class="chip done">有报告</span>' : '<span class="chip">可生成</span>'}
            </div>
            <div class="c-sub">${r.total} 条 · ${Object.entries(r.by_platform || {}).map(([p, n]) => `${esc(PF_META[p]?.label || p)} ${n}`).join(' / ')}</div>
            ${(r.platform_status ? Object.entries(r.platform_status) : []).some(([, s]) => s !== 'ok') ? `<div class="c-sub" style="color:var(--warn)">⚠️ ${esc(Object.entries(r.platform_status).filter(([, s]) => s !== 'ok').map(([p, s]) => `${p}: ${s}`).join(' / '))}</div>` : ''}
            <div class="c-foot"><span>${esc(String(r.fetched_at).slice(0, 16).replace('T', ' '))}</span><span style="margin-left:auto">${r.days === 0 ? '不限时' : `最近${r.days}天`} · 按${esc(r.sort_by)} · Top${r.top}</span></div>
          </a>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有搜索记录</div><p>输入关键词点「搜索三平台」。</p></div>`}
      </section>`
  }

  // ---------- 视图：搜索详情 ----------
  async function viewSearch(id) {
    let data
    try {
      data = await api(`/api/searches/${encodeURIComponent(id)}`)
    } catch (e) {
      const netDown = !e.status
      return `<a class="back" href="#/">${ic('back')} 概览</a><div class="empty"><div class="e-title">${netDown ? '面板服务连接失败' : '搜索记录不存在'}</div><p>${netDown ? '开发预览：DSH_HOME=<数据目录> node scripts/devserver.mjs' : esc(e.message)}</p></div>`
    }
    const meta = data.search
    const platKeys = meta.platforms || []

    const pstats = platKeys.map((p) => {
      const st = meta.platform_status?.[p] || 'ok'
      return `<div class="pstat" style="--pc:${esc(PF_META[p]?.color || 'var(--accent)')}">
        <div class="p-name">${esc(PF_META[p]?.label || p)}</div>
        <div class="p-num">${meta.by_platform?.[p] ?? 0}<span class="unit" style="font-size:12px;color:var(--text-helper)"> 条</span></div>
        <div class="p-sub">${st === 'ok' ? '正常' : esc(st)}</div>
      </div>`
    }).join('')

    const langNote = meta.pref_lang ? ` · 语言优先：${meta.pref_lang === 'zh' ? '中文' : meta.pref_lang === 'en' ? 'English' : meta.pref_lang}` : ''
    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <div class="detail-head">
        <div>
          <h1>${esc(meta.keyword_label)}</h1>
          <div class="c-sub" style="margin-top:4px">${meta.days === 0 ? '不限时间' : `最近 ${meta.days} 天`} · 按${esc(meta.sort_by)}降序 · 每平台 Top ${meta.top}${langNote} · 抓取于 ${esc(String(meta.fetched_at).slice(0, 16).replace('T', ' '))}</div>
        </div>
        <div class="actions">
          ${meta.has_report
            ? `<button class="btn accent" data-open-report="${esc(id)}">${ic('ext')}打开 HTML 报告</button>`
            : `<button class="btn accent" id="mk-report">${ic('play')}生成 HTML 报告</button>`}
          <button class="btn ghost" data-dig="${esc(id)}">${ic('spark')}去对话深挖</button>
          <button class="btn ghost" data-del-search="${esc(id)}" title="删除记录">${ic('trash')}</button>
        </div>
      </div>
      ${meta.dropped ? `<div class="plat-err">${meta.dropped} 条发布时间缺失或超出时间窗口已排除——TikTok 热门多为历史内容，需要请回概览放宽时间窗口重查。</div>` : ''}
      <div class="pstats">${pstats}</div>
      <div class="block" style="margin-top:var(--sp-6)">
        <div class="block-head"><h3>交互式 HTML 报告</h3><span class="mono">卡片 / 表格双视图</span></div>
        <div class="block-body" id="report-holder"><div class="loading">LOADING…</div></div>
      </div>`
  }

  function bindSearch(id, data) {
    // 报告走独立 iframe（模板自带卡片/表格双视图 JS）
    const holder = document.getElementById('report-holder')
    if (holder) {
      const frame = document.createElement('iframe')
      frame.src = `/overseas-trending/api/searches/${encodeURIComponent(id)}/report`
      frame.title = 'HTML 报告'
      frame.style.cssText = 'width:100%;min-height:760px;border:0;background:var(--paper);display:block'
      holder.innerHTML = ''
      holder.appendChild(frame)
    }
    const del = document.querySelector('[data-del-search]')
    if (del) del.onclick = async () => {
      if (!confirm('删除这条搜索记录？（条目与报告一并删除，不可恢复）')) return
      try {
        await apiDelete(`/api/searches/${encodeURIComponent(id)}`)
        toast('已删除')
        location.hash = '#/'
      } catch (e) { toast(e.message, true) }
    }
    const dig = document.querySelector('[data-dig]')
    if (dig) dig.onclick = () => {
      sendAgentPrompt(digPrompt(data.search), '已在宿主开新对话——agent 跨平台对比解读')
    }
    const mk = document.getElementById('mk-report')
    if (mk) mk.onclick = async () => {
      mk.disabled = true
      try {
        await apiPost(`/api/searches/${encodeURIComponent(id)}/report`)
        toast('HTML 报告已生成')
        location.reload()
      } catch (e) { toast(e.message, true); mk.disabled = false }
    }
  }

  // ---------- HTML 报告查看器（覆盖层，避免依赖 window.open） ----------
  async function openReportView(id) {
    document.getElementById('report-view')?.remove()
    const el = document.createElement('div')
    el.id = 'report-view'
    el.className = 'report-view'
    el.innerHTML = `
      <div class="rv-panel" role="dialog" aria-modal="true" aria-label="HTML 报告">
        <div class="rv-bar">
          <div class="rv-title">${ic('ext')}<span>深色主题 HTML 报告（卡片/表格双视图）</span></div>
          <div class="rv-actions">
            <button class="btn ghost" id="rv-close">关闭</button>
          </div>
        </div>
        <div class="rv-body"><div class="loading">LOADING…</div></div>
      </div>`
    document.body.appendChild(el)
    const body = el.querySelector('.rv-body')
    const close = () => {
      removeEventListener('keydown', onKey)
      el.remove()
    }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    el.querySelector('#rv-close').onclick = close
    el.addEventListener('click', (e) => { if (e.target === el) close() })
    try {
      const res = await fetch(`/overseas-trending/api/searches/${encodeURIComponent(id)}/report`, { cache: 'no-store' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `HTTP ${res.status}`)
      }
      const html = await res.text()
      const frame = document.createElement('iframe')
      frame.className = 'rv-frame'
      frame.title = 'HTML 报告'
      frame.srcdoc = html
      body.innerHTML = ''
      body.appendChild(frame)
    } catch (e) {
      body.innerHTML = `<div class="empty"><div class="e-title">报告打不开</div><p>${esc(e.message)}</p></div>`
    }
  }

  // ---------- 视图：设置 ----------
  function viewSettings() {
    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <header class="head">
        <span class="eyebrow">SETTINGS</span>
        <h1>设<strong>置</strong></h1>
        <p>RedFox API Key 是三平台搜索的唯一凭证。这里保存的 Key 优先于环境变量，低于插件配置。YouTube 详情补全消耗较多积分，请在搜索表单控制「DETAIL TOP」。</p>
      </header>
      <div class="form">
        <div class="field"><label>API KEY · RedFox API Key（ak_ 开头）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-key" placeholder="ak_…" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-key-save">保存 Key</button>
          </div>
          <div class="hint" id="s-key-hint">…</div>
          <div class="hint">获取：<a href="https://redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">redfox.hk/settings/api-keys ↗</a>。保存在本机 dsh 数据目录，不上传。</div>
        </div>
        <div class="field"><label>PROXY · HTTP(S) 代理（访问 redfox.hk 走代理时填；清空 = 直连）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-proxy" placeholder="http://127.0.0.1:7890" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-proxy-save">保存代理</button>
          </div>
        </div>
        <div class="field"><label>API BASE · 接口地址（测试/自建网关用，默认 https://redfox.hk）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-base" placeholder="https://redfox.hk" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-base-save">保存地址</button>
          </div>
        </div>
      </div>`
  }

  async function bindSettings() {
    async function refreshSettings() {
      try {
        const { settings } = await api('/api/settings')
        const keyHint = document.getElementById('s-key-hint')
        if (keyHint) keyHint.textContent = settings.has_key
          ? `已配置（…${settings.key_tail || '******'}${settings.from_env ? '，其中环境变量可用' : ''}）。重新输入会覆盖。`
          : '未配置。'
        const inp = document.getElementById('s-key')
        if (inp && document.activeElement !== inp) inp.placeholder = settings.has_key ? `已配置（…${settings.key_tail}），输入新值覆盖` : 'ak_…'
        const proxy = document.getElementById('s-proxy')
        if (proxy && document.activeElement !== proxy) proxy.value = settings.proxy_url || ''
        const base = document.getElementById('s-base')
        if (base && document.activeElement !== base) base.value = settings.api_base || ''
      } catch { /* 宿主未就绪 */ }
    }
    await refreshSettings()
    const bind = (id, payload) => {
      const btn = document.getElementById(id)
      if (!btn) return
      btn.onclick = async () => {
        try {
          const input = btn.parentElement.querySelector('input')
          await apiPost('/api/settings', payload(input.value.trim()))
          toast('设置已保存')
          await refreshSettings()
          loadCatalog().catch(() => {})
        } catch (e) { toast(e.message, true) }
      }
    }
    bind('s-key-save', (v) => ({ api_key: v }))
    bind('s-proxy-save', (v) => ({ proxy_url: v }))
    bind('s-base-save', (v) => ({ api_base: v }))
  }

  // ---------- 渲染辅助 ----------
  function bindCommon() {
    bindExternalLinks()
    document.querySelectorAll('[data-open-report]').forEach((b) => {
      b.onclick = () => { openReportView(b.dataset.openReport) }
    })
    const goBtn = document.getElementById('f-go')
    if (goBtn) goBtn.onclick = async () => {
      const kw = document.getElementById('f-kw')?.value.trim() || ''
      if (!kw) { toast('先填关键词', true); return }
      const platforms = [...document.querySelectorAll('input[name="pf"]:checked')].map((n) => n.value)
      if (!platforms.length) { toast('至少选一个平台', true); return }
      const status = document.getElementById('f-status')
      const label = goBtn.innerHTML
      goBtn.disabled = true
      // 三平台并行采集通常 20-60s，YouTube 详情补全可能到 2 分钟：给可见的计时器，别让界面像卡死
      const startedAt = Date.now()
      const tick = () => {
        const s = Math.round((Date.now() - startedAt) / 1000)
        goBtn.textContent = `搜索中… ${s}s`
        if (status) {
          status.textContent = s >= 180
            ? `已 ${s}s：上游较慢（YouTube 点赞/评论需逐条补全），可继续等或点刷新重试（重试会再扣积分）`
            : `三平台并行采集中，已 ${s}s（通常 20-60s，YouTube 详情补全最慢）…`
        }
      }
      tick()
      const timer = setInterval(tick, 1000)
      try {
        const r = await apiPost('/api/searches', {
          keywords: kw,
          platforms,
          days: Number(document.getElementById('f-days')?.value) || 0,
          sort_by: document.getElementById('f-sort')?.value || 'views',
          top: Number(document.getElementById('f-top')?.value) || 5,
          detail_top: (() => {
            const v = document.getElementById('f-detail')?.value
            return v === undefined || v === '' ? 5 : Number(v)
          })(),
        })
        if (r.ok === false) { toast(r.error, r.all_down); if (status) status.textContent = ''; return }
        toast(`搜索完成：共 ${r.search.total} 条`)
        location.hash = `#/s/${encodeURIComponent(r.search.search_id)}`
      } catch (e) {
        toast(e.message, true)
        if (status) status.textContent = ''
      } finally {
        clearInterval(timer)
        goBtn.innerHTML = label
        goBtn.disabled = false
      }
    }
  }

  // ---------- 路由 ----------
  async function render() {
    try { await loadCatalog() } catch {}
    const hash = location.hash || '#/'
    const ms = hash.match(/^#\/s\/(.+)$/)
    const searchId = ms ? decodeURIComponent(ms[1]) : null
    document.querySelectorAll('.nav a').forEach((a) => {
      const cur = searchId ? '' : hash === '#/' ? 'home' : hash.startsWith('#/settings') ? 'settings' : 'home'
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (searchId && /^[\p{L}\p{N}_-]+$/u.test(searchId)) {
      $app.innerHTML = await viewSearch(searchId)
      bindCommon()
      try {
        const data = await api(`/api/searches/${encodeURIComponent(searchId)}`)
        bindSearch(searchId, data)
      } catch { /* 卡片已在 HTML 中提示错误 */ }
      return
    }
    if (hash.startsWith('#/settings')) { $app.innerHTML = viewSettings(); bindCommon(); bindSettings(); return }
    $app.innerHTML = viewHome()
    bindCommon()
  }

  async function boot() {
    try { await loadCatalog() } catch {
      state.catalog = { version: '-', has_key: false, key_source: 'none', platforms: [], searches: [], settings: {} }
      renderNavCounts()
    }
    render().catch(() => {})
  }
  // 报告 iframe 里的链接点击会 postMessage 过来，统一交给 openLink 走系统浏览器
  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return
    const m = e.data
    if (m && m.type === 'dsh:open-link' && typeof m.url === 'string') openLink(m.url)
  })
  addEventListener('hashchange', () => render())
  boot()
  setTimeout(() => { if (!state.catalog?.version || state.catalog.version === '-') boot() }, 2500)
})()
