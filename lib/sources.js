// 三平台适配器（移植自上游 sources/：x_source.py / tiktok_source.py / youtube_source.py / base.py）。
// 统一记录 schema：platform / title / url / author / likes / comments / views / shares / publish_ts / publish_time / keyword / lang。
import {
  X_SEARCH_PATH, TIKTOK_SEARCH_PATH, YOUTUBE_SEARCH_PATH, YOUTUBE_DETAIL_PATH,
  SOURCE_LABEL, PlatformUnavailable, platformPost, postJsonStable,
} from './redfox.js'

const pad = (n) => String(n).padStart(2, '0')

// 千/万简写（展示用）
export function formatNumber(n) {
  const num = Number(n) || 0
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return String(num)
}

// ── base 工具（上游 BaseSource）───────────────────────────────────────────
function toInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function fmtTs(ts) {
  const t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return ''
  const ms = t > 1e12 ? t : t * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 兼容秒/毫秒时间戳、ISO 时间串、相对时间（"1 day ago"/"2 天前"），返回秒级 int
const REL_UNITS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }
const REL_UNITS_ZH = { '秒': 1, '分钟': 60, '小时': 3600, '天': 86400, '周': 604800, '个月': 2592000, '月': 2592000, '年': 31536000 }

export function parseTs(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
    const ts = Number(value)
    return Number.isFinite(ts) ? (ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)) : 0
  }
  const s = String(value).trim()
  // ISO："2026-07-24T10:00:00Z" / "2026-07-24 10:00:00"
  const iso = Date.parse(s.replace(/ Z$/, 'Z').replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  if (Number.isFinite(iso) && /^\d{4}/.test(s)) return Math.floor(iso / 1000)
  // 相对时间（英文/中文）
  const en = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i.exec(s)
  if (en) return Math.floor((Date.now() - Number(en[1]) * (REL_UNITS[en[2].toLowerCase()] || 0) * 1000) / 1000)
  const zh = /(\d+)\s*(个月|分钟|小时|秒|天|周|月|年)前/.exec(s)
  if (zh) return Math.floor((Date.now() - Number(zh[1]) * (REL_UNITS_ZH[zh[2]] || 0) * 1000) / 1000)
  // "Streamed 1 day ago" / "x hours ago"（无 ago 后缀兜底）
  const en2 = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(s)
  if (en2) return Math.floor((Date.now() - Number(en2[1]) * (REL_UNITS[en2[2].toLowerCase()] || 0) * 1000) / 1000)
  return 0
}

// YouTube 本地化计数字符串 → int："1928万"/"1.9M"/"24K"/"1,797,749,387次观看"
export function parseDisplayCount(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Math.round(value)
  const text = String(value).trim().replace(/,/g, '').replace(/\s/g, '')
  const m = /^([\d.]+)(.*)$/.exec(text)
  if (!m) return 0
  const num = Number.parseFloat(m[1])
  if (!Number.isFinite(num)) return 0
  const suffix = m[2].toUpperCase()
  const mult = suffix.includes('亿') ? 1e8 : suffix.includes('万') ? 1e4 : suffix.includes('千') ? 1e3
    : suffix.startsWith('B') ? 1e9 : suffix.startsWith('M') ? 1e6 : suffix.startsWith('K') ? 1e3 : 1
  return Math.round(num * mult)
}

// "2026年7月24日" → 秒级时间戳
export function parseCnDate(value) {
  const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(String(value || '').trim())
  if (!m) return 0
  const ts = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return Number.isNaN(ts) ? 0 : Math.floor(ts / 1000)
}

// 轻量语言识别（上游 detect_lang）：zh=汉字无假名 / ja=假名 / ko=谚文 / en=拉丁 / other
export function detectLang(text) {
  let hasHan = false, hasKana = false, hasHangul = false, hasLatin = false
  for (const ch of String(text || '')) {
    const o = ch.codePointAt(0)
    if ((o >= 0x4e00 && o <= 0x9fff) || (o >= 0x3400 && o <= 0x4dbf)) hasHan = true
    else if (o >= 0x3040 && o <= 0x30ff) hasKana = true
    else if (o >= 0xac00 && o <= 0xd7af) hasHangul = true
    else if (o < 0x80 && /[a-z]/i.test(ch)) hasLatin = true
  }
  if (hasHan) return hasKana ? 'ja' : 'zh'
  if (hasKana) return 'ja'
  if (hasHangul) return 'ko'
  if (hasLatin) return 'en'
  return 'other'
}

function makeRecord(platform, displayName, { title, url, author, likes, comments, views, publishTs, keyword, extra }) {
  return {
    platform,
    platform_name: displayName,
    title: String(title || '').trim() || '无标题',
    url: url || '',
    author: String(author || '').trim() || '未知作者',
    likes: toInt(likes),
    comments: toInt(comments),
    views: toInt(views),
    shares: toInt(extra?.shares),
    publish_ts: toInt(publishTs),
    publish_time: fmtTs(publishTs),
    keyword: keyword || '',
    work_id: extra?.work_id || '',
    cover: extra?.cover || '',
    lang: detectLang(String(title || '')),
  }
}

// ── X 适配器（search 必填 searchType=Top，缺失会误报 3203）────────────────
export async function searchX({ keyword, apiKey, apiBase, proxyUrl }) {
  const json = await platformPost(X_SEARCH_PATH, {
    keyword, searchType: 'Top', cursor: '', source: SOURCE_LABEL,
  }, { apiKey, apiBase, proxyUrl })
  const data = json?.data
  const tweets = typeof data === 'object' && data ? data.tweets : null
  if (!Array.isArray(tweets)) return []
  return tweets.map((t) => {
    const user = t.user || {}
    const username = t.username || user.username || ''
    const tweetId = String(t.tweetId || '')
    return makeRecord('x', 'X', {
      title: t.text || '',
      url: username && tweetId ? `https://x.com/${username}/status/${tweetId}` : '',
      author: user.displayName || username,
      likes: t.likeCount, comments: t.replyCount, views: t.viewCount,
      publishTs: parseTs(t.createdAt), keyword,
      extra: { shares: toInt(t.retweetCount), work_id: tweetId },
    })
  })
}

// ── TikTok 适配器（接口已变更：需 offset+count，上游脚本未更新）────────────
export async function searchTikTok({ keyword, apiKey, apiBase, proxyUrl }) {
  const json = await platformPost(TIKTOK_SEARCH_PATH, {
    keyword, offset: 0, count: 20, source: SOURCE_LABEL,
  }, { apiKey, apiBase, proxyUrl })
  const data = json?.data
  if (!Array.isArray(data)) return []
  return data.map((item) => {
    const stats = item.statsData || {}
    const author = item.authorData || {}
    return makeRecord('tiktok', 'TikTok', {
      title: item.content || '',
      url: item.shareLink || '',
      author: author.userName || author.userHandle || '',
      likes: stats.likeCount, comments: stats.commentTotal, views: stats.viewCount,
      publishTs: parseTs(item.publishTime), keyword,
      extra: { shares: toInt(stats.shareTotal), work_id: String(item.workId || ''), cover: (item.videoData || {}).coverImage || '' },
    })
  })
}

// ── YouTube 适配器（searchVideo 播放数 + videoDetail 逐条补点赞/评论）───────
export async function searchYouTube({ keyword, apiKey, apiBase, proxyUrl, detailTop = 20 } = {}) {
  const json = await platformPost(YOUTUBE_SEARCH_PATH, {
    searchQuery: keyword, source: SOURCE_LABEL,
  }, { apiKey, apiBase, proxyUrl })
  const data = json?.data
  const videos = typeof data === 'object' && data ? data.videos : null
  if (!Array.isArray(videos)) return []

  // 按播放量排序，只对前 detailTop 条调详情（点赞/评论仅详情接口提供，省积分）
  const items = videos.filter((v) => v && typeof v === 'object')
    .sort((a, b) => toInt(b.viewCount) - toInt(a.viewCount))
  const details = {}
  // 实测单条 videoDetail 约 15-25s：串行 10 条要近 2 分钟，改成小并发 + 总预算
  const vids = items.slice(0, Math.max(0, Math.min(detailTop, 20)))
    .map((v) => String(v.videoId || '')).filter(Boolean)
  const deadline = Date.now() + 45000
  const CONCURRENCY = 4
  let cursor = 0
  async function worker() {
    while (cursor < vids.length && Date.now() < deadline) {
      const vid = vids[cursor++]
      try {
        const detail = await postJsonStable(YOUTUBE_DETAIL_PATH, { videoId: vid }, { apiKey, apiBase, proxyUrl, maxRetries: 1, timeout: 20000 })
        if (detail?.code && [200, 2000].includes(detail.code) && detail.data && typeof detail.data === 'object') {
          details[vid] = detail.data
        }
      } catch { /* 详情失败回退 0，不中断 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, vids.length) }, worker))

  return items.map((item) => {
    const vid = String(item.videoId || '')
    const detail = details[vid] || {}
    const thumbs = Array.isArray(item.thumbnails) ? item.thumbnails : []
    let cover = ''
    if (thumbs.length) {
      const best = thumbs.reduce((p, c) => ((toInt(c.width) * toInt(c.height)) > (toInt(p.width) * toInt(p.height)) ? c : p), thumbs[0])
      cover = String(best.url || '')
    }
    return makeRecord('youtube', 'YouTube', {
      title: item.title || detail.title || '',
      url: detail.videoUrl || (vid ? `https://www.youtube.com/watch?v=${vid}` : ''),
      author: item.author || detail.author || '',
      likes: parseDisplayCount(detail.likeCount), comments: parseDisplayCount(detail.commentCount),
      views: toInt(item.viewCount) || parseDisplayCount(detail.viewCount),
      publishTs: parseCnDate(detail.date) || parseTs(item.publishedTime), keyword,
      extra: { shares: 0, work_id: vid, cover, duration: item.duration || '' },
    })
  })
}

const SEARCHERS = {
  x: searchX,
  tiktok: searchTikTok,
  youtube: searchYouTube,
}

export { SEARCHERS }
