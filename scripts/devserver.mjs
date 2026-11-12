// 开发预览：把B站AI信息源面板跑在独立 http 服务上（复用 lib/api.js 路由 + 真实数据）。
//   DSH_HOME=<数据目录> node scripts/devserver.mjs [port]   默认 5195
// 想连真实 API 就在数据目录 settings.json 里放 api_key（npm run live 会自动写入）。
import { createServer } from 'node:http'
import { registerApi } from '../lib/api.js'

const port = Number(process.argv[2]) || 5195
const routes = {}
const fakeCtx = { get: () => undefined, webServer: { register: (r) => { routes[r.path] = r.handler } } }
registerApi(fakeCtx, { config: {} })

createServer(async (req, res) => {
  try {
    await routes['/overseas-trending'](req, res)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: e.message }))
  }
}).listen(port, () => console.log(`[dev] http://127.0.0.1:${port}/overseas-trending/  (DSH_HOME=${process.env.DSH_HOME || '~/.dsh'})`))
