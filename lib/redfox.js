// RedFox API · 海外跨平台热文搜索传输层（X / TikTok / YouTube 三平台端点）。
// 与同族插件同款传输：JSON POST + 可选 CONNECT 隧道代理，双 header。
// 实测要点（2026-11-13）：X search 必填 searchType；TikTok searchVideo 需 offset+count（上游脚本未更新此参数）。
import http from 'node:http'
import https from 'node:https'
import { TLSSocket } from 'node:tls'

export const DEFAULT_API_BASE = 'https://redfox.hk'
export const BASE_PATH = '/story/api'
export const X_SEARCH_PATH = '/x/search'
export const X_DETAIL_PATH = '/x/tweetDetail'
export const TIKTOK_SEARCH_PATH = '/tiktok/ability/searchVideo'
export const TIKTOK_DETAIL_PATH = '/tiktok/ability/awemeDetail'
export const YOUTUBE_SEARCH_PATH = '/youtube/searchVideo'
export const YOUTUBE_DETAIL_PATH = '/youtube/videoDetail'
export const SOURCE_LABEL = 'ChinaTrendingDigest-dsh'

export const SUCCESS_CODES = [200, 2000]
export const PLATFORM_KEYS = ['x', 'tiktok', 'youtube']

export function resolveApiKey({ settings = {}, config = {} } = {}) {
  return String(config.apiKey || settings.api_key || process.env.REDFOX_API_KEY || process.env.X_API_KEY || '').trim()
}

export function resolveApiBase({ settings = {} } = {}) {
  const base = String(settings.api_base || process.env.REDFOX_API_BASE || '').trim()
  return (base || DEFAULT_API_BASE).replace(/\/+$/, '')
}

function connectTunnel(proxyUrl, targetHost, targetPort, timeout) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl)
    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { host: `${targetHost}:${targetPort}` },
      timeout,
    })
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`proxy CONNECT ${res.statusCode}`)); return }
      resolve(socket)
    })
    req.on('timeout', () => req.destroy(new Error('proxy connect timeout')))
    req.on('error', reject)
    req.end()
  })
}

export function httpPostJson(url, body, { timeout = 30000, proxyUrl = '', headers = {} } = {}) {
  const u = new URL(url)
  const isHttp = u.protocol === 'http:'
  const port = Number(u.port) || (isHttp ? 80 : 443)
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const transport = isHttp ? http : https
  const opts = {
    host: u.hostname,
    port,
    method: 'POST',
    path: `${u.pathname}${u.search}`,
    headers: {
      'content-type': 'application/json',
      'content-length': payload.length,
      ...headers,
    },
  }
  return new Promise((resolve, reject) => {
    const finish = (socket) => {
      const req = transport.request(socket ? { ...opts, socket, agent: false } : { ...opts, agent: false }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) })
          } catch {
            reject(new Error(`响应不是合法 JSON（HTTP ${res.statusCode}）：${text.slice(0, 200)}`))
          }
        })
      })
      req.on('error', reject)
      req.setTimeout(timeout, () => req.destroy(new Error(`请求超时（${timeout}ms）`)))
      req.end(payload)
    }
    if (proxyUrl && !isHttp) {
      connectTunnel(proxyUrl, u.hostname, port, timeout)
        .then((socket) => finish(new TLSSocket(socket, { servername: u.hostname })))
        .catch(reject)
    } else {
      finish()
    }
  })
}

export class InsufficientCreditsError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InsufficientCreditsError'
  }
}

// 平台上游能力不可用（如 RedFox 3203 能力故障），主流程优雅降级跳过该平台
export class PlatformUnavailable extends Error {
  constructor(message) {
    super(message)
    this.name = 'PlatformUnavailable'
  }
}

export function friendlyApiError(json) {
  const code = json?.code
  const msg = String(json?.msg || json?.message || '')
  if (code === 3201 || msg.includes('积分不足')) {
    return new InsufficientCreditsError('RedFox 账户积分不足（3201）：请到 https://redfox.hk/dashboard/recharge 充值，或确认 Key 已绑定可用积分。')
  }
  if (code === 3203 || msg.includes('付费调用') || msg.includes('能力调用失败')) {
    return new PlatformUnavailable(`RedFox 上游能力故障（3203）：${msg}`)
  }
  if (code === 3106 || code === 3107) return new Error(`RedFox 鉴权失败（${code}）：请检查面板「设置」页的 API Key。`)
  if (code === 3108) return new Error('RedFox 提交被限频（3108），稍等片刻再试。')
  if (code === 401 || code === 403) return new Error(`RedFox 鉴权失败（${code}）：请检查面板「设置」页的 API Key。`)
  return new Error(`API 错误（code=${code ?? '?'}）：${msg || JSON.stringify(json).slice(0, 200)}`)
}

// 稳健 POST（递增延迟重试，与上游 BaseSource.post_json 一致）：彻底失败返回 null
export async function postJsonStable(url, payload, { apiKey, apiBase, proxyUrl = '', maxRetries = 3, timeout = 30000 } = {}) {
  if (!apiKey) {
    throw new Error('未配置 RedFox API Key。请到面板「设置」页填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://redfox.hk/settings/api-keys?source=github）。')
  }
  const headers = {
    'X-API-KEY': apiKey,
    'REDFOX_API_KEY': apiKey,
    'User-Agent': 'overseas-trending/0.1',
  }
  let lastErr = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { json } = await httpPostJson(`${apiBase}${BASE_PATH}${url}`, payload, { timeout, proxyUrl, headers })
      return json
    } catch (err) {
      lastErr = err
      if (attempt < maxRetries - 1) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw lastErr || new Error(`请求失败（已尝试 ${maxRetries} 次）`)
}

// 平台请求统一包装：3108 退避一次；3201 抛积分不足；3203 → PlatformUnavailable；其他业务码抛错
export async function platformPost(path, payload, opts) {
  const json = await postJsonStable(path, payload, opts)
  const code = json?.code
  if (code === 3108) {
    await new Promise((r) => setTimeout(r, 5000))
    const retry = await postJsonStable(path, payload, opts)
    const retryCode = retry?.code
    if (retryCode === 3201) throw friendlyApiError(retry)
    if (!SUCCESS_CODES.includes(retryCode)) throw friendlyApiError(retry)
    return retry
  }
  if (code === 3201) throw friendlyApiError(json)
  if (!SUCCESS_CODES.includes(code)) throw friendlyApiError(json)
  return json
}
