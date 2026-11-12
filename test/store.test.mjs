import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'dsh-overseas-store-'))
process.env.DSH_HOME = tmp
delete process.env.REDFOX_API_KEY

const { saveSearch, getMeta, getRaw, listSearches, publicMeta, deleteSearch, getSettings, saveSettings, saveReportHtml, readReportHtml, resolveSearch } = await import('../lib/store.js')
const { formatDigestHtml } = await import('../lib/report.js')

test.after(() => { rmSync(tmp, { recursive: true, force: true }) })

const searchFixture = () => ({
  keyword_label: 'AI agent',
  keywords: ['AI agent'],
  platforms: ['x', 'youtube'],
  records: [
    { platform: 'x', platform_name: 'X', title: 'tweet one', url: 'https://x.com/u/1', author: 'a', likes: 100, comments: 10, views: 5000, shares: 5, publish_ts: 1700000000, publish_time: '2023-11-14 22:13:20', keyword: 'AI agent', work_id: '1', cover: '', lang: 'en' },
    { platform: 'youtube', platform_name: 'YouTube', title: 'video one', url: 'https://www.youtube.com/watch?v=v1', author: 'b', likes: 200, comments: 20, views: 8000, shares: 0, publish_ts: 1700000000, publish_time: '2023-11-14 22:13:20', keyword: 'AI agent', work_id: 'v1', cover: '', lang: 'en' },
  ],
  platform_status: { x: 'ok', tiktok: 'RedFox 上游能力故障（3203）：X能力调用失败' },
  dropped: 1,
  dropped_detail: { tiktok: 1 },
  days: 1,
  pref_lang: 'en',
  sort_by: 'views',
  top: 5,
  fetched_at: '2026-11-13T02:00:00.000Z',
})

test('saveSearch/listSearches/getMeta/getRaw 全链路', () => {
  const meta = saveSearch(searchFixture())
  assert.ok(meta.search_id.includes('-AI-agent'))
  assert.equal(meta.total, 2)
  assert.deepEqual(meta.by_platform, { x: 1, youtube: 1 })
  const got = getMeta(meta.search_id)
  assert.equal(got.platform_status.x, 'ok')
  const raw = getRaw(meta.search_id)
  assert.equal(raw.records.length, 2)
  const pub = publicMeta(got)
  assert.equal(pub.has_report, false)
  const list = listSearches()
  assert.equal(list.length, 1)
})

test('settings', () => {
  saveSettings({ api_key: 'ak_test', proxy_url: '' })
  assert.equal(getSettings().api_key, 'ak_test')
})

test('resolveSearch：缺省最新 + 不存在抛错', () => {
  const meta = resolveSearch(undefined)
  assert.equal(meta.keyword_label, 'AI agent')
  assert.throws(() => resolveSearch('nope'), /不存在/)
})

test('report.html 落盘 + formatDigestHtml（INITIAL_DATA 注入）', () => {
  const meta = listSearches()[0]
  const raw = getRaw(meta.search_id)
  const html = formatDigestHtml({ data: raw })
  assert.ok(html.includes('tweet one'))
  assert.ok(html.includes('INITIAL_DATA'))
  assert.ok(html.includes('video one'))
  assert.ok(html.includes('x: 正常'))
  assert.ok(!html.includes('{{KEYWORD}}') && !html.includes('{{INITIAL_DATA}}') && !html.includes('{{TOTAL_COUNT}}') && !html.includes('[object Object]'))
  saveReportHtml(meta.search_id, html)
  assert.ok(readReportHtml(meta.search_id))
  assert.equal(publicMeta(getMeta(meta.search_id)).has_report, true)
})

test('deleteSearch', () => {
  const meta = listSearches()[0]
  assert.ok(existsSync(join(tmp, 'overseas-trending', 'searches', meta.search_id)))
  assert.deepEqual(deleteSearch(meta.search_id), { ok: true })
  assert.equal(listSearches().length, 0)
  assert.equal(deleteSearch(meta.search_id).ok, false)
})
