import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTs, parseDisplayCount, parseCnDate, detectLang, formatNumber, searchX, searchTikTok, searchYouTube } from '../lib/sources.js'
import { keywordPrefLang, sortRecords, limitPerPlatform, filterByDays } from '../lib/engine.js'

const mk = (platform, title, url, author, likes, comments, views, publishTs, extra = {}) => ({
  platform, platform_name: platform, title, url, author,
  likes, comments, views, shares: extra.shares || 0,
  publish_ts: publishTs, publish_time: publishTs ? new Date(publishTs * 1000).toISOString() : '',
  keyword: 'kw', work_id: '', cover: '', lang: detectLang(title), ...Object.fromEntries(Object.entries(extra).filter(([k]) => k === 'cover' || k === 'work_id')),
})

test('detectLang：zh/ja/ko/en/other', () => {
  assert.equal(detectLang('南海问题的分析'), 'zh')
  assert.equal(detectLang('南海電鉄の路線'), 'ja')
  assert.equal(detectLang('한국어 뉴스'), 'ko')
  assert.equal(detectLang('AI agent review'), 'en')
  assert.equal(detectLang('中文标题 with English'), 'zh')
  assert.equal(detectLang('12345'), 'other')
})

test('keywordPrefLang：关键词推断优先语言（全汉字日文词按 zh，上游同款行为）', () => {
  assert.equal(keywordPrefLang(['人工智能', 'AI agent']), 'zh')
  assert.equal(keywordPrefLang(['AI agent', 'review']), 'en')
  assert.equal(keywordPrefLang(['テスト']), 'ja') // 含假名才判 ja
  assert.equal(keywordPrefLang(['南海電鉄']), 'zh') // 全汉字（上游同款：有汉字无假名→zh）
})

test('parseTs：秒/毫秒/ISO/相对时间', () => {
  assert.equal(parseTs(1700000000), 1700000000)
  assert.equal(parseTs('1700000000000'), 1700000000)
  const now = Math.floor(Date.now() / 1000)
  const rel = parseTs('3 hours ago')
  assert.ok(Math.abs(rel - (now - 3 * 3600)) < 60)
  const zh = parseTs('2 天前')
  assert.ok(Math.abs(zh - (now - 2 * 86400)) < 60)
  assert.equal(parseTs('2026年7月24日'), 0) // 中文日期走 parseCnDate
})

test('parseDisplayCount：本地化计数串', () => {
  assert.equal(parseDisplayCount('1928万'), 19280000)
  assert.equal(parseDisplayCount('1.9M'), 1900000)
  assert.equal(parseDisplayCount('24K'), 24000)
  assert.equal(parseDisplayCount('1,797,749,387次观看'), 1797749387)
  assert.equal(parseDisplayCount(123), 123)
  assert.equal(parseDisplayCount(null), 0)
})

test('parseCnDate', () => {
  assert.equal(parseCnDate('2026年7月24日'), Math.floor(new Date(2026, 6, 24).getTime() / 1000))
  assert.equal(parseCnDate('2026-07-24'), 0)
})

test('sortRecords：指标降序 + 语言分层', () => {
  const records = [
    mk('x', 'japanese テレビ news', '', 'a', 5000, 100, 100, 1000),
    mk('x', 'english review', '', 'b', 4000, 100, 100, 1000),
    mk('x', '中文内容最高赞', '', 'c', 3000, 100, 100, 1000),
    mk('x', 'another 中文内容', '', 'd', 2000, 100, 100, 1000),
  ]
  // 中文关键词优先：中文内容排前（即使赞少），英文其次，日文兜底
  const sorted = sortRecords(records, 'likes', 'zh')
  assert.equal(sorted[0].lang, 'zh')
  assert.equal(sorted[1].lang, 'zh')
  assert.equal(sorted[2].lang, 'en')
  assert.equal(sorted[3].lang, 'ja')
  // 不分层：按赞降序
  const plain = sortRecords(records, 'likes')
  assert.equal(plain[0].author, 'a')
})

test('limitPerPlatform：平台分组 + 组内 Top N', () => {
  const records = [
    mk('x', 'x1', '', '', 100, 0, 0, 1000),
    mk('x', 'x2', '', '', 200, 0, 0, 1000),
    mk('youtube', 'y1', '', '', 50, 0, 0, 1000),
    mk('youtube', 'y2', '', '', 150, 0, 0, 1000),
    mk('tiktok', 't1', '', '', 10, 0, 0, 1000),
  ]
  const merged = limitPerPlatform(records, 1, 'likes')
  assert.deepEqual(merged.map((r) => r.title), ['x2', 'y2', 't1'])
})

test('filterByDays：时间窗口过滤 + 平台统计', () => {
  const now = Math.floor(Date.now() / 1000)
  const records = [
    mk('x', 'new', '', '', 100, 0, 0, now - 1000),
    mk('tiktok', 'old', '', '', 200, 0, 0, now - 10 * 86400),
    mk('tiktok', 'missing', '', '', 100, 0, 0, 0),
  ]
  const { records: kept, dropped } = filterByDays(records, 1)
  assert.equal(kept.length, 1)
  assert.equal(dropped.length, 2)
  assert.deepEqual(filterByDays(records, 0).records.length, 3)
})

test('formatNumber：千/万简写', () => {
  assert.equal(formatNumber(473000), '47.3w')
  assert.equal(formatNumber(1500), '1.5k')
  assert.equal(formatNumber(999), '999')
})
