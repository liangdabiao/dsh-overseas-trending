// 海外跨平台热文搜索 · Host 半边（overseas_search 原生工具 + overseas-trending 技能提供方 + 硬规则注入 + 面板数据面）。
// 三平台适配器采集 + 语言分层 + 时间窗口过滤 + HTML 报告（INITIAL_DATA 注入卡片/表格双视图）。
import Schema from '@deepseek-ai/schemastery'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { systemSection } from './systemPrompt.js'
import { registerApi } from '../lib/api.js'
import { searchTrending, searchOpts, SORT_LABELS, SOURCE_LABEL } from '../lib/engine.js'
import { PLATFORM_KEYS } from '../lib/redfox.js'
import { formatNumber } from '../lib/sources.js'
import { formatDigestHtml } from '../lib/report.js'
import {
  saveSearch, getMeta, getRaw, listSearches, publicMeta, getSettings, saveReportHtml, resolveSearch,
} from '../lib/store.js'

export const name = 'overseas-trending' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'systemPrompt', 'webServer', 'connection']

export const Config = Schema.object({
  injectRules: Schema.boolean().default(true).description('注入海外热文搜索工作流到系统提示'),
  apiKey: Schema.string().default('').description('RedFox API Key（ak_ 开头；留空读面板设置或环境变量 REDFOX_API_KEY）'),
  proxyUrl: Schema.string().default('').description('HTTP(S) 代理（访问 redfox.hk 用），留空直连'),
})

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：分组条目列表/平台状态' },
      footer: { type: 'string', description: '可选：输出时需逐字附带的引擎页脚' },
    },
  },
  render: (_args, value) => text([value.summary, value.data, value.footer].filter(Boolean).join('\n\n')),
}

const result = (ok, summary, data = '', footer = '') => ({ ok, summary, data, footer })

const MAX_TEXT = 58000

function buildFooter(meta) {
  const status = Object.entries(meta.platform_status || {})
    .map(([p, s]) => `${p}${s === 'ok' ? '✓' : '⚠' + String(s).slice(0, 30)}`)
    .join(' / ')
  return `🌐 数据源：redfox.hk API（海外跨平台热文搜索）· 「${meta.keyword_label}」· ${meta.days === 0 ? '不限时间' : `最近${meta.days}天`} · 按${SORT_LABELS[meta.sort_by] || meta.sort_by}降序 · 每平台Top${meta.top}${meta.pref_lang ? ` · ${meta.pref_lang === 'zh' ? '中文' : meta.pref_lang === 'en' ? 'English' : meta.pref_lang}优先` : ''} · 记录 ${meta.search_id} · ${status}`
}

// 单条记录行（模型可读）
function renderRow(r, idx) {
  const pf = r.platform === 'x' ? '𝕏' : r.platform === 'tiktok' ? 'TikTok' : 'YouTube'
  return `${idx}｜[${pf}] [${String(r.title).slice(0, 40)}](${r.url})｜${r.author}｜▶${formatNumber(r.views)} 👍${formatNumber(r.likes)} 💬${formatNumber(r.comments)}｜${String(r.publish_time || '').slice(0, 16)}`
}

// ---------------------------------------------------------------------------
// 工具：overseas_search —— search / list / get
// ---------------------------------------------------------------------------
export const overseasSearchTool = {
  name: 'overseas_search',
  description:
    '海外跨平台热文搜索：输入任意关键词（中文/英文）一次搜索 X / TikTok / YouTube 三平台热门内容，每平台 Top N 统一列表（平台/标题/作者/播放/点赞/评论/发布时间/链接）。' +
    '语言优先分层：中文关键词优先中文内容、英文关键词优先英文内容。深色主题 HTML 报告（卡片/表格双视图）。' +
    '⚠️积分消耗较大：YouTube 点赞/评论需逐条调详情接口补全（每次搜索最多 20 次详情调用）——不要主动重复搜索或跑多个关键词组合。' +
    'TikTok 热门多为历史内容，默认 1 天窗口会滤掉大部分 TikTok 结果，看 TikTok 热门建议 days 放宽到 3-7 或 0。' +
    '需要 RedFox API Key（面板「设置」页或环境变量 REDFOX_API_KEY）。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('search 搜索；list 历史记录；get 读详情', { enum: ['search', 'list', 'get'] }),
      keywords: str('search：关键词，中英文均可，多个用英文逗号分隔（如 "人工智能,AI agent"）'),
      platforms: str('search：平台逗号分隔 x,tiktok,youtube（默认全部三个；某平台故障会优雅降级）'),
      days: num('search：时间窗口最近 N 天（默认 1，0=不限；TikTok 建议放宽）'),
      sortBy: str('search：排序 views/likes/comments/time（默认 views）'),
      top: num('search：每平台最多返回条数，默认 5（0=不限）'),
      detailTop: num('search：YouTube 详情补全条数（默认 20，调小省积分；点赞/评论仅详情接口提供）'),
      searchId: str('get 定位：目标搜索记录 id；缺省=最新一次'),
    },
  },
  output: OUTPUT,
  async execute(args, ctxConfig) {
    check(args, this.parameters)
    const cfg = ctxConfig || {}

    // ── search ───────────────────────────────────────────────────────────
    if (args.action === 'search') {
      const opts = searchOpts({ settings: getSettings(), config: cfg })
      if (!opts.apiKey) {
        return result(false, '未配置 RedFox API Key。请用户到面板「海外跨平台热文搜索 → 设置」填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://redfox.hk/settings/api-keys?source=github）。')
      }
      const data = await searchTrending({
        keywords: args.keywords,
        platforms: args.platforms,
        days: args.days,
        sortBy: args.sortBy,
        top: args.top,
        detailTop: args.detailTop,
        ...opts,
      })

      // 平台状态总览（优雅降级如实标注）
      const statusLines = Object.entries(data.platform_status)
        .map(([p, s]) => `${p}: ${s === 'ok' ? '正常' : s}`)
      const downCount = Object.values(data.platform_status).filter((s) => s !== 'ok').length

      if (!data.records.length) {
        const allDown = downCount >= data.platforms.length
        const tiktokHint = data.dropped > 0 && (data.dropped_detail?.tiktok || 0) > 0 ? `（${data.dropped} 条被时间窗口排除，其中 TikTok ${data.dropped_detail.tiktok} 条——TikTok 热门多为历史内容，建议 days 放宽到 3-7 或 0 重试）` : ''
        return result(false,
          allDown
            ? `全部平台均无结果或上游故障：\n${statusLines.join('\n')}\n${tiktokHint}如实向用户转述平台状态，不要编造条目。`
            : `时间窗口内无内容。${tiktokHint}\n${statusLines.join('\n')}`,
          '', `🌐 数据源：redfox.hk API（海外跨平台热文搜索）· 0 条 · ${statusLines.join(' / ')}`)
      }

      const meta = saveSearch(data)
      const html = formatDigestHtml({ data })
      saveReportHtml(meta.search_id, html)
      const pm = publicMeta(meta)

      // 平台分组条目
      const groups = new Map()
      for (const r of data.records) {
        if (!groups.has(r.platform)) groups.set(r.platform, [])
        groups.get(r.platform).push(r)
      }
      const langNote = data.pref_lang ? `（语言优先：${data.pref_lang === 'zh' ? '中文' : data.pref_lang === 'en' ? 'English' : data.pref_lang} 内容优先，其他语言兜底）` : ''
      const droppedNote = data.dropped ? `\n\n⚠️ ${data.dropped} 条发布时间缺失或超出最近 ${data.days} 天窗口已排除（${Object.entries(data.dropped_detail).map(([p, n]) => `${p} ${n} 条`).join('，')}）${data.dropped_detail?.tiktok ? '——TikTok 热门多为历史内容，需要请用 days=0 或 7 重查' : ''}` : ''

      const body = [
        `**搜索「${data.keyword_label}」· 共 ${data.records.length} 条 · 每平台 Top ${data.top} · 按${SORT_LABELS[data.sort_by] || data.sort_by}降序**${langNote}`,
        data.dropped ? droppedNote.trim() : '',
        '',
        ...[...groups.entries()].flatMap(([pf, items]) => [
          `**【${pf === 'x' ? 'X' : pf === 'tiktok' ? 'TikTok' : 'YouTube'}】${items.length} 条${data.platform_status[pf] !== 'ok' ? ` ⚠️ ${data.platform_status[pf]}` : ''}**`,
          ...items.map((r, i) => `  ${renderRow(r, i + 1)}`),
          '',
        ]),
        `HTML 报告（卡片/表格双视图）已生成。桌面端 WebContentsView 会 deny window.open/target=_blank，报告只能在面板内查看——告诉用户点侧栏「海外跨平台热文搜索」的搜索详情页（searchId=${meta.search_id}），不要把磁盘路径当成可点开的入口。`,
      ].filter((s) => s !== undefined).join('\n')

      const summary =
        `已入库（searchId=${meta.search_id}）。共 ${data.records.length} 条（${[...groups.entries()].map(([p, items]) => `${p} ${items.length}`).join('/')}）。` +
        `${downCount ? `⚠️ ${downCount} 个平台故障已降级，如实转述。` : ''}按平台分组向用户呈现（标题前 20 字 + 全字段），末尾逐字附页脚。跨平台对比解读由你完成。`

      return result(true, summary, body.slice(0, MAX_TEXT), buildFooter(pm))
    }

    // ── list ─────────────────────────────────────────────────────────────
    if (args.action === 'list') {
      const list = listSearches({ limit: 20 })
      if (!list.length) return result(false, '还没有搜索记录。先 search。')
      const lines = list.map((r) =>
        `${r.search_id}｜${r.keyword_label}｜${r.total}条（${Object.entries(r.by_platform).map(([p, n]) => `${p}${n}`).join('/')}）｜${r.days === 0 ? '不限时' : r.days + '天'}`)
      return result(true, `共 ${list.length} 次搜索（新→旧）。读详情用 action="get"。`, lines.join('\n').slice(0, MAX_TEXT))
    }

    // ── get ──────────────────────────────────────────────────────────────
    if (args.action === 'get') {
      const meta = resolveSearch(args.searchId)
      const raw = getRaw(meta.search_id)
      if (!raw) throw new Error(`搜索数据缺失：${meta.search_id}`)
      const pool = raw.records || []
      const body = pool.slice(0, 60).map((r, i) => renderRow(r, i + 1)).join('\n')
      return result(true,
        `「${meta.keyword_label}」共 ${pool.length} 条。引用时链接取 url 字段。`,
        body.slice(0, MAX_TEXT), buildFooter(publicMeta(meta)))
    }

    throw new Error(`未知 action：${args.action}`)
  },
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  const toolWithConfig = { ...overseasSearchTool, execute(args) { return overseasSearchTool.execute(args, config) } }

  ctx.effect(() => ctx.tools.register(toolWithConfig), `${name}: tool`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  if (config.injectRules !== false) {
    ctx.effect(() => ctx.systemPrompt.section(systemSection()), `${name}: workflow`)
  }
  ctx.effect(() => registerApi(ctx, { config }), `${name}: routes`)
}

export { publicMeta }
