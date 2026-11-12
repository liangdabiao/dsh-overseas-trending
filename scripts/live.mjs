// 真实网络冒烟：一次三平台搜索（消耗较多积分：YouTube 详情补全），打印分组结果与平台状态。
//   DSH_HOME=<目录> node scripts/live.mjs [关键词] [ak_xxx]
// key 优先级：命令行第二参 > 数据目录 settings.json > 环境变量 REDFOX_API_KEY。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , kwArg, keyArg] = process.argv
const home = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE, '.dsh')

if (keyArg) {
  mkdirSync(join(home, 'overseas-trending'), { recursive: true })
  writeFileSync(join(home, 'overseas-trending', 'settings.json'), JSON.stringify({ api_key: keyArg }, null, 2))
  console.log('API key 已写入 settings.json')
}
const { getSettings } = await import('../lib/store.js')
if (!getSettings().api_key && !process.env.REDFOX_API_KEY && !process.env.X_API_KEY) {
  console.error('缺少 RedFox API Key：node scripts/live.mjs <关键词> ak_xxx')
  process.exit(1)
}

const { overseasSearchTool } = await import('../src/host.js')
const call = (args) => overseasSearchTool.execute(args, {})

const keyword = kwArg || 'AI agent'
console.log(`真实搜索：「${keyword}」三平台 Top5（消耗较多积分，YouTube 详情补全 20 次）`)
const t0 = Date.now()
const r = await call({ action: 'search', keywords: keyword, days: 0, top: 5, detailTop: 20 })
console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] ${r.summary}`)
if (r.data) console.log(r.data.split('\n').slice(0, 24).join('\n') + '\n…')
console.log(`\n页脚: ${r.footer || '—'}`)
