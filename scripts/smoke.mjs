// 冒烟测试（离线）：假三平台 RedFox 服务器 + 工具直调全链路（降级/语言分层/时间窗口）+ 面板 API 全路由。
// 运行：npm run smoke
const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const http = await import('node:http')

const tmp = mkdtempSync(join(tmpdir(), 'dsh-overseas-smoke-'))
process.env.DSH_HOME = tmp
delete process.env.REDFOX_API_KEY
delete process.env.X_API_KEY

let failed = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failed++
}

// ── 假 RedFox 三平台服务器 ──
let detailCalls = 0
const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers['x-api-key'] !== 'ak_smoke') return reply({ code: 3106, msg: 'bad key' })
    const payload = JSON.parse(body || '{}')
    const url = req.url

    if (url === '/story/api/x/search') {
      // 3 条推文（含一条日文，验证语言分层）
      return reply({ code: 2000, data: { tweets: [
        { tweetId: 't1', username: 'user1', user: { displayName: 'User One', username: 'user1', followers: 1000 }, text: 'AI agent 中文讨论帖', likeCount: 5000, replyCount: 300, retweetCount: 200, viewCount: 100000, createdAt: '2026-11-13 08:00:00', language: 'zh' },
        { tweetId: 't2', username: 'user2', user: { displayName: 'User Two' }, text: 'english AI agent thread', likeCount: 8000, replyCount: 500, retweetCount: 100, viewCount: 90000, createdAt: Date.now() - 3600000, language: 'en' },
        { tweetId: 't3', username: 'jp_user', user: { displayName: '日本語' }, text: 'AIエージェント 日本語ポスト', likeCount: 20000, replyCount: 800, retweetCount: 300, viewCount: 200000, createdAt: Date.now() - 7200000, language: 'ja' },
      ] } })
    }
    if (url === '/story/api/tiktok/ability/searchVideo') {
      // 校验 offset+count（接口已变更）
      if (payload.offset === undefined || payload.count === undefined) return reply({ code: 3203, msg: '接口执行异常，积分未扣除: count不能为空' })
      return reply({ code: 2000, data: [
        { workId: 'tt1', content: 'TikTok AI agent 短视频文案', shareLink: 'https://www.tiktok.com/@a/video/1', authorData: { userName: 'creator1' }, statsData: { likeCount: 30000, commentTotal: 1500, viewCount: 500000, shareTotal: 800 }, publishTime: Date.now() - 86400_000 * 2, videoData: { coverImage: 'https://p16-sign.example/c.jpg' }, area: 'US' },
        { workId: 'tt2', content: '中文 TikTok 内容', shareLink: 'https://www.tiktok.com/@a/video/2', authorData: { userName: 'creator2' }, statsData: { likeCount: 15000, commentTotal: 700, viewCount: 300000, shareTotal: 400 }, publishTime: Date.now() - 3600_000, videoData: { coverImage: '' }, area: 'US' },
      ] })
    }
    if (url === '/story/api/youtube/searchVideo') {
      return reply({ code: 2000, data: { videos: [
        { videoId: 'v1', title: 'AI agent deep dive English', author: 'Channel A', viewCount: 950000, publishedTime: '1 day ago', duration: '12:00', channelId: 'c1', thumbnails: [{ url: 'https://i.ytimg.com/vi/v1/hq.jpg', width: 480, height: 360 }] },
        { videoId: 'v2', title: 'AI agent 中文解读', author: '频道B', viewCount: 200000, publishedTime: '2 days ago', duration: '8:00', channelId: 'c2', thumbnails: [{ url: 'https://i.ytimg.com/vi/v2/hq.jpg', width: 480, height: 360 }] },
      ] } })
    }
    if (url === '/story/api/youtube/videoDetail') {
      detailCalls++
      const vid = payload.videoId
      return reply({ code: 2000, data: { videoId: vid, likeCount: vid === 'v1' ? '1.2万' : '8,543', commentCount: vid === 'v1' ? '2,431' : '543', date: '2026年11月12日', videoUrl: `https://www.youtube.com/watch?v=${vid}`, author: vid === 'v1' ? 'Channel A' : '频道B' } })
    }
    return reply({ code: 404, msg: 'not found' })
  })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
mkdirSync(join(tmp, 'overseas-trending'), { recursive: true })
writeFileSync(join(tmp, 'overseas-trending', 'settings.json'), JSON.stringify({ api_key: 'ak_smoke', api_base: `http://127.0.0.1:${srv.address().port}` }))

// ── 工具直调 ──
const { overseasSearchTool } = await import('../src/host.js')
const call = async (args) => {
  try { return await overseasSearchTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
}
let sid
{
  const r = await call({ action: 'search', keywords: 'AI agent', days: 0, top: 5, detailTop: 20 })
  check('search 入库', r.ok && r.summary.includes('searchId='), r.summary.slice(0, 60))
  sid = r.summary.match(/searchId=([\p{L}\p{N}-]+)/u)?.[1]
  check('search 三平台分组', r.data.includes('【X】') && r.data.includes('【TikTok】') && r.data.includes('【YouTube】'), '')
  check('search X 链接拼接', r.data.includes('https://x.com/user1/status/t1'), '')
  check('search YouTube 详情补全', r.data.includes('👍1.2w'), `detailCalls=${detailCalls}`)
  check('search TikTok offset+count', detailCalls >= 0 && r.data.includes('TikTok AI agent'), '')
  check('search 语言分层（中文词…实际英文词 en 优先）', r.data.indexOf('english AI agent') < r.data.indexOf('AIエージェント'), '')
  check('search 页脚带平台状态', (r.footer || '').includes('x✓') && (r.footer || '').includes(sid), (r.footer || '').slice(0, 90))
}
{
  // 时间窗口：days=1 会滤掉 TikTok 2 天前的内容（publishTime now-2day）
  const r = await call({ action: 'search', keywords: 'AI agent', days: 1, top: 5 })
  check('时间窗口过滤 + 如实标注', r.ok && r.summary.includes('searchId=') && r.data.includes('窗口已排除') && r.data.includes('TikTok'), (r.data.match(/窗口已排除[^\n]*/) || [''])[0].slice(0, 90))
}
{
  // 优雅降级：TikTok 缺 offset 会 3203 → 平台标注故障不中断
  const r = await call({ action: 'list' })
  check('list 历史记录', r.ok && r.data.split('\n').length >= 2, (r.data || '').split('\n')[0])
  const r2 = await call({ action: 'get', searchId: sid })
  check('get 补读条目', r2.ok && r2.data.includes('https://x.com/user1/status/t1'), '')
  const bad = await call({ action: 'search', keywords: '' })
  check('空关键词报错', !bad.ok && bad.summary.includes('keywords 必填'), '')
  const badPf = await call({ action: 'search', keywords: 'x', platforms: 'instagram' })
  check('未知平台报错', !badPf.ok && badPf.summary.includes('platforms'), '')
  const unknown = await call({ action: 'destroy' })
  check('未知 action 报错', !unknown.ok && unknown.summary.includes('只能是'), '')
}

// ── 面板 API ──
const { registerApi } = await import('../lib/api.js')
const { Writable } = await import('node:stream')
const { EventEmitter } = await import('node:events')
const routes = {}
registerApi({ get: () => undefined, webServer: { register: (r) => { routes[r.path] = r.handler } } }, { config: {} })
const req = async (method, path, body) => {
  const reqObj = new EventEmitter()
  reqObj.method = method
  reqObj.url = `/overseas-trending${path}`
  reqObj.headers = body ? { 'content-type': 'application/json', host: 'x', origin: 'http://x' } : { host: 'x' }
  const chunks = []
  const resObj = new Writable({ write(c, _e, cb) { chunks.push(c); cb() } })
  resObj.statusCode = 0
  resObj.writeHead = (code) => { resObj.statusCode = code }
  const done = new Promise((resolve) => {
    const origEnd = resObj.end.bind(resObj)
    resObj.end = (...args) => { origEnd(...args); resolve({ status: resObj.statusCode, json: (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null } })(), text: () => Buffer.concat(chunks).toString('utf8') }) }
  })
  const p = routes['/overseas-trending'](reqObj, resObj)
  if (body) reqObj.emit('data', Buffer.from(JSON.stringify(body)))
  reqObj.emit('end')
  await p
  return done
}
{
  const cat = await req('GET', '/api/catalog')
  check('catalog：key/平台/历史', cat.status === 200 && cat.json.has_key && cat.json.platforms.length === 3 && cat.json.searches.length >= 2, '')
  const one = await req('GET', `/api/searches/${sid}`)
  check('搜索详情带 raw', one.status === 200 && one.json.raw?.records?.length >= 5, '')
  check('详情带平台状态', one.json.search?.platform_status?.x === 'ok', '')
  const rep = await req('GET', `/api/searches/${sid}/report`)
  const html = rep.text ? rep.text() : ''
  check('HTML 报告关键元素', rep.status === 200 && html.includes('INITIAL_DATA') && html.includes('AI agent'), '')
  check('HTML 无占位残留', !html.includes('{{KEYWORD}}') && !html.includes('{{INITIAL_DATA}}') && !html.includes('[object Object]'), '')
  // 面板直搜（POST 路由必须覆盖）
  const panelSearch = await req('POST', '/api/searches', { keywords: 'AI agent', platforms: ['x'], days: 0, top: 5, detail_top: 10 })
  check('面板直搜+HTML落盘', panelSearch.status === 200 && panelSearch.json.ok && panelSearch.json.search.total >= 1, `err=${panelSearch.json?.error || '-'}`)
  const del = await req('DELETE', `/api/searches/${panelSearch.json.search.search_id}`)
  check('面板删记录', del.status === 200 && del.json.ok, '')
}
{
  const st = await req('GET', '/api/settings')
  check('settings GET 尾号', st.status === 200 && st.json.settings.has_key && st.json.settings.key_tail.length === 6, String(st.json.settings.key_tail))
  const bad = await req('POST', '/api/settings', { api_key: 'no-prefix' })
  check('settings 非 ak_ 拒绝', bad.status === 400, '')
}
{
  const idx = readFileSync(new URL('../lab/index.html', import.meta.url), 'utf8')
  check('lab 引用 scheme/app', idx.includes('app.js') && idx.includes('scheme.js'), '')
  const appjs = readFileSync(new URL('../lab/app.js', import.meta.url), 'utf8')
  check('lab 消息类型与 client 对齐', appjs.includes('overseas-trending:refresh') && appjs.includes('overseas-trending:start-ok'), '')
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  check('client 消息类型一致', client.includes('overseas-trending:refresh') && client.includes('overseas-trending:start-ok'), '')
  const skill = readFileSync(new URL('../skills/overseas-trending/SKILL.md', import.meta.url), 'utf8')
  check('技能含口径与积分纪律', skill.includes('detailTop') && skill.includes('积分'), '')
}

srv.close()
rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
