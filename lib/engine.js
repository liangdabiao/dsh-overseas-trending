// 海外跨平台热文搜索引擎（移植自上游 digest.py 主编排器）：
// keywords × platforms 循环采集（平台故障优雅降级）→ 时间窗口过滤 → 语言分层 + 组内降序 + 每平台 Top N → HTML 报告（INITIAL_DATA 注入）。
import { PLATFORM_KEYS, SOURCE_LABEL, resolveApiKey, resolveApiBase, InsufficientCreditsError } from './redfox.js'
import { SEARCHERS, detectLang } from './sources.js'
import { formatDigestHtml } from './report.js'

export function searchOpts({ settings = {}, config = {} } = {}) {
  return {
    apiKey: resolveApiKey({ settings, config }),
    apiBase: resolveApiBase({ settings }),
    proxyUrl: config?.proxyUrl || settings.proxy_url || '',
  }
}

const SORT_LABELS = { likes: '点赞数', views: '播放数', comments: '评论数', time: '发布时间' }
export { SORT_LABELS }

// 语言分层：0=关键词同语言，1=中文/英文，2=其他语言
function langTier(lang, pref) {
  if (!pref || lang === pref) return 0
  if (lang === 'zh' || lang === 'en') return 1
  return 2
}

// 关键词推断优先语言：含汉字→zh，纯拉丁→en，假名→ja，谚文→ko
export function keywordPrefLang(keywords) {
  const lang = detectLang(keywords.join(' '))
  return ['zh', 'en', 'ja', 'ko'].includes(lang) ? lang : null
}

// 排序键：主指标降序，次序兜底（likes→views→ts 等）
function sortKey(r, sortBy) {
  const views = r.views || 0
  const likes = r.likes || 0
  const comments = r.comments || 0
  const ts = r.publish_ts || 0
  if (sortBy === 'time') return [ts, views, likes]
  if (sortBy === 'views') return [views, likes, ts]
  if (sortBy === 'comments') return [comments, views, likes, ts]
  return [likes, views, ts] // likes
}

// 语言分层 + 指标降序（先按指标稳定排序，再按语言层稳定排序）
export function sortRecords(records, sortBy, prefLang = null) {
  let sorted = [...records].sort((a, b) => {
    const ka = sortKey(a, sortBy)
    const kb = sortKey(b, sortBy)
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const d = (kb[i] || 0) - (ka[i] || 0)
      if (d) return d
    }
    return 0
  })
  if (prefLang) {
    sorted = sorted
      .map((r) => ({ ...r, _tier: langTier(r.lang, prefLang) }))
      .sort((a, b) => a._tier - b._tier)
      .map(({ _tier, ...r }) => r)
  }
  return sorted
}

// 时间窗口过滤（publish_ts 缺失或超窗排除，返回 { records, dropped }）
export function filterByDays(records, days) {
  if (days <= 0) return { records, dropped: [] }
  const cutoff = Math.floor((Date.now() - days * 86400_000) / 1000)
  const kept = []
  const dropped = []
  for (const r of records) {
    const ts = Number(r.publish_ts) || 0
    if (ts && ts >= cutoff) kept.push(r)
    else dropped.push(r)
  }
  return { records: kept, dropped }
}

// 平台分组 → 组内排序（语言分层 + 指标降序）→ 每组截取前 top N（0=不限）→ 按平台顺序合并
export function limitPerPlatform(records, top, sortBy, prefLang = null) {
  const groups = new Map()
  for (const r of records) {
    const pf = r.platform || '?'
    if (!groups.has(pf)) groups.set(pf, [])
    groups.get(pf).push(r)
  }
  const merged = []
  for (const [pf, group] of groups) {
    const g = sortRecords(group, sortBy, prefLang)
    merged.push(...(top > 0 ? g.slice(0, top) : g))
  }
  return merged
}

/**
 * 跨平台搜索（同步，约 5-40 秒视平台数与 YouTube 详情补全量）。
 * @returns {{ keyword_label, keywords, platforms, records, platform_status, dropped, dropped_detail, pref_lang, sort_by, top, days, fetched_at }}
 */
export async function searchTrending({
  keywords, platforms, days = 1, sortBy = 'views', top = 5, detailTop = 20,
  apiKey, apiBase, proxyUrl = '', now = new Date(),
} = {}) {
  if (!apiKey) throw new Error('未配置 RedFox API Key。请到面板「设置」页填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://redfox.hk/settings/api-keys?source=github）。')
  const kws = String(keywords || '').split(/[,，]/).map((k) => k.trim()).filter(Boolean)
  if (!kws.length) throw new Error('keywords 必填（多个用英文逗号分隔）。')
  const plats = (Array.isArray(platforms) ? platforms : String(platforms || 'x,tiktok,youtube').split(','))
    .map((p) => p.trim().toLowerCase()).filter((p) => PLATFORM_KEYS.includes(p))
  if (!plats.length) throw new Error(`platforms 只能是 ${PLATFORM_KEYS.join('/')} 的任意组合`)

  const prefLang = keywordPrefLang(kws)
  const allRecords = []
  const platformStatus = {}

  // 三平台并行采集：串行时总耗时 ≈ 9s+13s+33s（YouTube 详情最慢），并行后 ≈ 最慢那个
  const results = await Promise.all(plats.map(async (pf) => {
    const records = []
    let error = ''
    try {
      for (const kw of kws) {
        const batch = await SEARCHERS[pf]({ keyword: kw, apiKey, apiBase, proxyUrl, detailTop })
        records.push(...batch)
      }
    } catch (err) {
      if (err instanceof InsufficientCreditsError) throw err
      error = String(err?.message || err)
    }
    // 语言标注（适配器内已标注 title 语言）
    for (const r of records) r.lang = detectLang(r.title)
    return { pf, records, error }
  }))
  for (const { pf, records, error } of results) {
    platformStatus[pf] = error || 'ok'
    allRecords.push(...records)
  }

  // 时间窗口过滤
  const { records: kept, dropped } = filterByDays(allRecords, days)
  const droppedDetail = {}
  for (const r of dropped) droppedDetail[r.platform] = (droppedDetail[r.platform] || 0) + 1

  const finalRecords = limitPerPlatform(kept, top, sortBy, prefLang)

  return {
    keyword_label: kws.join(','),
    keywords: kws,
    platforms: plats,
    records: finalRecords,
    platform_status: platformStatus,
    dropped: dropped.length,
    dropped_detail: droppedDetail,
    days,
    pref_lang: prefLang,
    sort_by: sortBy,
    top,
    fetched_at: new Date().toISOString(),
  }
}

export { SOURCE_LABEL, formatDigestHtml }
