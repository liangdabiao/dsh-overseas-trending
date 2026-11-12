// 海外跨平台热文搜索 · 数据层。
//   $DSH_HOME/overseas-trending/
//   ├── settings.json            api_key / api_base(测试用) / proxy_url
//   ├── searches/index.json      搜索索引（新→旧）
//   └── searches/<id>/
//       ├── meta.json            关键词/平台/统计/平台状态
//       ├── raw.json             searchTrending 完整结果（records）
//       └── report.html          交互式 HTML 报告（卡片/表格双视图）
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'overseas-trending')
const SEARCHES_DIR = join(DATA_DIR, 'searches')
const INDEX_FILE = join(SEARCHES_DIR, 'index.json')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')

const nowIso = () => new Date().toISOString()

function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(SEARCHES_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

function writeFile(file, content) {
  mkdirSync(SEARCHES_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, String(content ?? ''), 'utf8')
  renameSync(tmp, file)
  return file
}

// ── 设置 ───────────────────────────────────────────────────────────────
export function getSettings() {
  return readJson(SETTINGS_FILE, {}) || {}
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch, updated_at: nowIso() }
  writeJson(SETTINGS_FILE, next)
  return next
}

// ── 搜索记录 ───────────────────────────────────────────────────────────
function searchDir(id) {
  const safe = String(id).replace(/[^\p{L}\p{N}_-]+/gu, '')
  if (!safe || safe !== String(id)) throw new Error('非法搜索 id')
  const dir = join(SEARCHES_DIR, safe)
  if (normalize(dir) !== normalize(join(SEARCHES_DIR, safe))) throw new Error('非法搜索 id')
  return dir
}

export function createSearchId(keywordLabel) {
  const ts = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const slug = String(keywordLabel).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'search'
  return `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}${String(ts.getMilliseconds()).padStart(3, '0')}-${slug}`
}

export function publicMeta(meta) {
  return {
    search_id: meta.search_id,
    keyword_label: meta.keyword_label,
    platforms: meta.platforms || [],
    platform_status: meta.platform_status || {},
    total: meta.total || 0,
    by_platform: meta.by_platform || {},
    days: meta.days ?? 1,
    sort_by: meta.sort_by || 'views',
    top: meta.top ?? 5,
    pref_lang: meta.pref_lang || '',
    dropped: meta.dropped || 0,
    fetched_at: meta.fetched_at,
    has_report: existsSync(join(SEARCHES_DIR, meta.search_id, 'report.html')),
  }
}

export function saveSearch(data) {
  const id = createSearchId(data.keyword_label)
  const dir = searchDir(id)
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'raw.json'), { ...data, search_id: id })
  const byPlatform = {}
  for (const r of data.records || []) byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1
  const meta = {
    search_id: id,
    keyword_label: data.keyword_label,
    platforms: data.platforms || [],
    platform_status: data.platform_status || {},
    total: data.records?.length || 0,
    by_platform: byPlatform,
    days: data.days ?? 1,
    sort_by: data.sort_by || 'views',
    top: data.top ?? 5,
    pref_lang: data.pref_lang || '',
    dropped: data.dropped || 0,
    fetched_at: data.fetched_at,
  }
  writeJson(join(dir, 'meta.json'), meta)
  const index = getSearchIndex().filter((i) => i.search_id !== id)
  index.unshift({ search_id: id, fetched_at: meta.fetched_at })
  writeJson(INDEX_FILE, index.slice(0, 200))
  return meta
}

export function getMeta(searchId) {
  return readJson(join(searchDir(searchId), 'meta.json'))
}

export function getRaw(searchId) {
  return readJson(join(searchDir(searchId), 'raw.json'))
}

function getSearchIndex() {
  return readJson(INDEX_FILE, []) || []
}

export function listSearches({ limit = 50 } = {}) {
  const index = getSearchIndex()
  const out = []
  for (const item of index.slice(0, limit)) {
    const meta = getMeta(item.search_id)
    if (meta) out.push(publicMeta(meta))
  }
  return out
}

export function resolveSearch(searchId) {
  if (searchId) {
    const meta = getMeta(searchId)
    if (!meta) throw new Error(`搜索记录不存在：${searchId}。用 list 查看已有记录。`)
    return meta
  }
  const [latest] = listSearches({ limit: 1 })
  if (!latest) throw new Error('还没有搜索记录。先 search。')
  return getMeta(latest.search_id)
}

export function saveReportHtml(searchId, html) {
  return writeFile(join(searchDir(searchId), 'report.html'), html)
}

export function readReportHtml(searchId) {
  const file = join(searchDir(searchId), 'report.html')
  return existsSync(file) ? file : null
}

export function deleteSearch(searchId) {
  const dir = searchDir(searchId)
  if (!existsSync(dir)) return { ok: false, error: `搜索记录不存在: ${searchId}` }
  rmSync(dir, { recursive: true, force: true })
  writeJson(INDEX_FILE, getSearchIndex().filter((i) => i.search_id !== searchId))
  return { ok: true }
}
