// HTML 报告渲染（上游 report_template.html：INITIAL_DATA JSON 注入 + 前端卡片/表格双视图 JS）。
// 占位符：{{KEYWORD}}/{{DATE}}/{{TIMESTAMP}}/{{TOTAL_COUNT}}/{{PLATFORM_STATUS}}/{{INITIAL_DATA}}
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc } from './html.js'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'report_template.html')

export function formatDigestHtml({ data }) {
  let template
  try {
    template = readFileSync(TEMPLATE, 'utf8')
  } catch (err) {
    throw new Error(`无法读取模板文件 ${TEMPLATE}: ${err.message}`)
  }
  const statusLabel = Object.entries(data.platform_status || {})
    .map(([pf, st]) => `${pf}: ${st === 'ok' ? '正常' : st}`)
    .join(' | ')
  return template
    .replaceAll('{{KEYWORD}}', esc(data.keyword_label || ''))
    .replaceAll('{{DATE}}', esc(String(data.fetched_at || '').slice(0, 10)))
    .replaceAll('{{TIMESTAMP}}', esc(String(data.fetched_at || '').replace('T', ' ').slice(0, 19)))
    .replaceAll('{{TOTAL_COUNT}}', String((data.records || []).length))
    .replaceAll('{{PLATFORM_STATUS}}', esc(statusLabel))
    .replaceAll('{{INITIAL_DATA}}', JSON.stringify(data.records || []))
}
