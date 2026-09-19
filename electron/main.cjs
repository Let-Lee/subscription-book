const { app, BrowserWindow, clipboard, ipcMain, safeStorage, shell } = require('electron')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const { domainToASCII } = require('node:url')

const isDev = !app.isPackaged
const userDataArgument = process.argv.find(argument => argument.startsWith('--user-data-dir='))
const testUserDataDirectory = process.env.AIRPORT_MANAGER_USER_DATA

if (testUserDataDirectory) {
  app.setPath('userData', testUserDataDirectory)
} else if (userDataArgument) {
  app.setPath('userData', userDataArgument.slice('--user-data-dir='.length))
}

const storePath = () => path.join(app.getPath('userData'), 'subscriptions.json')
const aiStorePath = () => path.join(app.getPath('userData'), 'ai-gateways.json')
const domainStorePath = () => path.join(app.getPath('userData'), 'domains.json')
const serverStorePath = () => path.join(app.getPath('userData'), 'servers.json')
const curlExecutable = process.platform === 'win32' ? 'curl.exe' : '/usr/bin/curl'

async function readFileSnippet(filePath, limit = 4096) {
  const file = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await file.read(buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

function readResponseHeaders(link) {
  return fs.mkdtemp(path.join(app.getPath('temp'), 'airport-manager-response-')).then(tempDir => new Promise((resolve, reject) => {
    const bodyPath = path.join(tempDir, 'body')
    const request = spawn(curlExecutable, ['-L', '--max-time', '12', '--connect-timeout', '5', '-sS', '-D', '-', '-o', bodyPath, '-A', 'Clash Meta/1.18.0', '-K', '-'], { windowsHide: true })
    let output = ''
    let errorOutput = ''
    request.stdout.on('data', chunk => { output += chunk.toString() })
    request.stderr.on('data', chunk => { errorOutput += chunk.toString() })
    request.stdin.end(`url = ${JSON.stringify(link)}\n`)
    request.on('error', reject)
    request.on('close', async code => {
      try {
        const bodySnippet = await readFileSnippet(bodyPath)
        await fs.rm(tempDir, { recursive: true, force: true })
        if (code !== 0) { reject(new Error(errorOutput.trim() || '请求命令执行失败')); return }
        resolve({ headers: output, bodySnippet })
      } catch (error) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        reject(error)
      }
    })
  }))
}

function parseHeaderBlock(rawHeaders) {
  const blocks = rawHeaders.split(/\r?\n\r?\n/).filter(block => /^HTTP\//m.test(block))
  const finalBlock = blocks.at(-1) || ''
  const [statusLine, ...lines] = finalBlock.split(/\r?\n/)
  const headers = {}
  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
  }
  const status = Number((statusLine.match(/\s(\d{3})\s/) || [])[1])
  return { status, headers }
}

function decodeTitle(value) {
  if (!value) return ''
  const source = value.replace(/^base64:/i, '').trim()
  if (!/^base64:/i.test(value)) return value
  try { return Buffer.from(source, 'base64').toString('utf8') } catch { return value }
}

function titleFromDisposition(value) {
  if (!value) return ''
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)
  const plain = value.match(/filename=\"?([^\";]+)\"?/i)
  const candidate = encoded?.[1] || plain?.[1]
  if (!candidate) return ''
  try { return decodeURIComponent(candidate) } catch { return candidate }
}

function parseSubscriptionInfo(value) {
  const fields = {}
  for (const part of (value || '').split(';')) {
    const [key, rawValue] = part.trim().split('=', 2)
    if (!key || rawValue === undefined) continue
    const number = Number(rawValue.trim())
    if (Number.isFinite(number)) fields[key.trim().toLowerCase()] = number
  }
  const upload = fields.upload || 0
  const download = fields.download || 0
  return {
    usedBytes: upload + download,
    totalBytes: fields.total > 0 ? fields.total : null,
    expire: fields.expire > 0 ? fields.expire : null,
  }
}

function fallbackName(link) {
  try { return new URL(link).hostname } catch { return '未命名订阅' }
}

function cleanBodySnippet(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonAtomic(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

async function readRecordArray(filePath, label) {
  const records = await readJsonFile(filePath, [])
  if (!Array.isArray(records)) throw new Error(`${label}数据文件格式无效`)
  return records
}

function textField(value, limit = 500) {
  return (typeof value === 'string' || typeof value === 'number' ? String(value) : '').trim().slice(0, limit)
}

function dateField(value, label) {
  const date = textField(value, 32)
  if (!date) return ''
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label}应为 YYYY-MM-DD 格式`)
  }
  return date
}

function urlField(value, label) {
  const url = textField(value, 2048)
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error()
  } catch {
    throw new Error(`${label}应为 http 或 https 地址`)
  }
  return url
}

function domainName(value) {
  const display = textField(value, 253).replace(/\.$/, '').toLowerCase()
  const ascii = domainToASCII(display)
  const labels = ascii.split('.')
  if (!ascii || ascii.length > 253 || labels.length < 2 || labels.some(label =>
    label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) throw new Error('请输入有效的域名')
  return { display, ascii }
}

function validateRecordArray(records, label) {
  if (!Array.isArray(records) || records.length > 2000 || records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
    throw new Error(`${label}数据格式无效`)
  }
}

function sanitizeDomainInput(records) {
  validateRecordArray(records, '域名')
  const ids = new Set()
  const names = new Set()
  return records.map(record => {
    const normalized = domainName(record.domain)
    const id = textField(record.id, 100) || randomUUID()
    if (ids.has(id) || names.has(normalized.ascii)) throw new Error('域名或记录 ID 重复')
    ids.add(id)
    names.add(normalized.ascii)
    return {
      id,
      domain: normalized.display,
      registrar: textField(record.registrar),
      expiryDate: dateField(record.expiryDate, '到期日'),
      rdapExpiryDate: dateField(record.rdapExpiryDate, '公开查询到期日'),
      autoRenew: Boolean(record.autoRenew),
      dnsProvider: textField(record.dnsProvider),
      nameservers: Array.isArray(record.nameservers) ? [...new Set(record.nameservers.map(value => textField(value, 253)).filter(Boolean))].slice(0, 30) : [],
      managementUrl: urlField(record.managementUrl, '管理后台'),
      note: textField(record.note, 5000),
      serverIds: Array.isArray(record.serverIds) ? [...new Set(record.serverIds.map(value => textField(value, 100)).filter(Boolean))].slice(0, 200) : [],
      lookupAt: typeof record.lookupAt === 'string' && !Number.isNaN(Date.parse(record.lookupAt)) ? new Date(record.lookupAt).toISOString() : null,
    }
  })
}

function sanitizeServerInput(records, savedRecords) {
  validateRecordArray(records, '云服务器')
  const previous = new Map(savedRecords.map(record => [String(record.id), record]))
  const ids = new Set()
  return records.map(record => {
    const id = textField(record.id, 100) || randomUUID()
    if (ids.has(id)) throw new Error('云服务器记录 ID 重复')
    ids.add(id)
    const rawPort = textField(record.sshPort, 6)
    const sshPort = rawPort ? Number(rawPort) : null
    if (rawPort && (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)) throw new Error('SSH 端口应为 1–65535')
    const publicIp = textField(record.publicIp, 100)
    const websiteUrl = urlField(record.websiteUrl, '网站检测地址')
    const saved = previous.get(id)
    return {
      id,
      name: textField(record.name) || '未命名云服务器',
      provider: textField(record.provider),
      region: textField(record.region),
      instanceId: textField(record.instanceId),
      publicIp,
      cpu: textField(record.cpu),
      memory: textField(record.memory),
      disk: textField(record.disk),
      billingMode: textField(record.billingMode, 100),
      expiryDate: dateField(record.expiryDate, '服务器到期日'),
      consoleUrl: urlField(record.consoleUrl, '控制台链接'),
      sshUser: textField(record.sshUser),
      sshPort,
      websiteUrl,
      note: textField(record.note, 5000),
      tcpResult: saved?.publicIp === publicIp && Number(saved?.sshPort || 0) === Number(sshPort || 0) ? saved.tcpResult || null : null,
      httpResult: saved?.websiteUrl === websiteUrl ? saved.httpResult || null : null,
    }
  })
}

function createWriteQueue() {
  let current = Promise.resolve()
  return {
    wait: () => current,
    run(task) {
      const next = current.then(task, task)
      current = next.catch(() => {})
      return next
    },
  }
}

const domainWriteQueue = createWriteQueue()
const serverWriteQueue = createWriteQueue()

let rdapBootstrapCache = null
let rdapBootstrapCachedAt = 0

async function fetchJsonLimited(url, label, timeoutMs = 10000) {
  let response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/rdap+json, application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error(`${label}超时`)
    throw new Error(`${label}无法连接：${error.message || '网络错误'}`)
  }
  if (!response.ok) throw new Error(`${label}返回 HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error(`${label}返回内容过大`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`${label}没有返回内容`)
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2_000_000) throw new Error(`${label}返回内容过大`)
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error(`${label}返回的不是有效 JSON`) }
}

async function rdapBaseUrls(asciiDomain) {
  if (!rdapBootstrapCache || Date.now() - rdapBootstrapCachedAt > 24 * 60 * 60 * 1000) {
    const bootstrap = await fetchJsonLimited('https://data.iana.org/rdap/dns.json', 'IANA RDAP 目录')
    if (!Array.isArray(bootstrap.services)) throw new Error('IANA RDAP 目录格式无效')
    rdapBootstrapCache = bootstrap.services
    rdapBootstrapCachedAt = Date.now()
  }
  const tld = asciiDomain.split('.').at(-1)
  const service = rdapBootstrapCache.find(entry =>
    Array.isArray(entry) && Array.isArray(entry[0]) && entry[0].some(value => String(value).toLowerCase() === tld)
  )
  const urls = Array.isArray(service?.[1]) ? service[1].filter(value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
  }) : []
  if (!urls.length) throw new Error(`找不到 .${tld} 的公开 RDAP 查询服务`)
  return urls.sort((a, b) => Number(b.startsWith('https:')) - Number(a.startsWith('https:')))
}

function rdapExpiry(events) {
  const matches = (Array.isArray(events) ? events : []).filter(event =>
    /expir/i.test(String(event?.eventAction || '')) && event?.eventDate && !Number.isNaN(Date.parse(event.eventDate))
  )
  const preferred = matches.find(event => /registration expiration/i.test(event.eventAction)) || matches[0]
  return preferred ? new Date(preferred.eventDate).toISOString().slice(0, 10) : ''
}

function rdapEntityName(entity) {
  const properties = Array.isArray(entity?.vcardArray?.[1]) ? entity.vcardArray[1] : []
  const fullName = properties.find(property => Array.isArray(property) && property[0] === 'fn')?.[3]
  const organization = properties.find(property => Array.isArray(property) && property[0] === 'org')?.[3]
  const name = Array.isArray(fullName) ? fullName.join(' ') : fullName || (Array.isArray(organization) ? organization.join(' ') : organization)
  return textField(name, 500) || textField(entity?.handle, 500)
}

function readCnnicWhois(asciiDomain) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: 'whois.cnnic.cn', port: 43 })
    const chunks = []
    let size = 0
    let finished = false
    const fail = message => {
      if (finished) return
      finished = true
      socket.destroy()
      reject(new Error(message))
    }
    socket.setTimeout(7000, () => fail('CNNIC WHOIS 查询超时'))
    socket.on('connect', () => socket.write(`${asciiDomain}\r\n`))
    socket.on('data', chunk => {
      size += chunk.length
      if (size > 256_000) { fail('CNNIC WHOIS 返回内容过大'); return }
      chunks.push(chunk)
    })
    socket.on('end', () => {
      if (finished) return
      finished = true
      const bytes = Buffer.concat(chunks)
      if (!bytes.length) { reject(new Error('CNNIC WHOIS 没有返回内容')); return }
      try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
      catch { resolve(new TextDecoder('gb18030').decode(bytes)) }
    })
    socket.on('error', () => fail('无法连接 CNNIC WHOIS 服务'))
    socket.on('close', () => { if (!finished) fail('CNNIC WHOIS 连接意外关闭') })
  })
}

async function lookupDomainCnnic(asciiDomain) {
  const response = await readCnnicWhois(asciiDomain)
  // WHOIS may include registrant contact data. Extract only the fields used by the app.
  const fields = new Map()
  for (const line of response.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z][a-z -]*):\s*(.*?)\s*$/i)
    if (!match) continue
    const key = match[1].trim().toLowerCase()
    fields.set(key, [...(fields.get(key) || []), match[2].trim()])
  }
  const returnedDomain = fields.get('domain name')?.[0]?.toLowerCase().replace(/\.$/, '')
  if (returnedDomain !== asciiDomain) throw new Error('CNNIC WHOIS 未返回该域名的登记信息')
  const rawExpiry = fields.get('expiration time')?.[0] || fields.get('expiry date')?.[0] || ''
  const expiry = rawExpiry.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || ''
  const nameservers = [...new Set((fields.get('name server') || [])
    .map(value => textField(value, 253).replace(/\.$/, '').toLowerCase())
    .filter(value => /^[a-z0-9.-]+$/.test(value)))].slice(0, 30)
  return {
    registrar: textField(fields.get('sponsoring registrar')?.[0] || fields.get('registrar')?.[0], 500),
    rdapExpiryDate: expiry ? dateField(expiry, '公开查询到期日') : '',
    nameservers,
    lookupAt: new Date().toISOString(),
    source: 'CNNIC WHOIS',
  }
}

async function lookupDomainRdap(value) {
  const { ascii } = domainName(value)
  const baseUrls = await rdapBaseUrls(ascii)
  let lastError
  for (const baseUrl of baseUrls) {
    try {
      const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
      const url = new URL(`domain/${encodeURIComponent(ascii)}`, base)
      const data = await fetchJsonLimited(url, 'RDAP 查询', 12000)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('RDAP 查询返回内容格式无效')
      const registrar = (Array.isArray(data.entities) ? data.entities : []).find(entity =>
        Array.isArray(entity?.roles) && entity.roles.includes('registrar')
      )
      const nameservers = Array.isArray(data.nameservers) ? [...new Set(data.nameservers
        .map(item => textField(item?.ldhName || item?.unicodeName, 253).replace(/\.$/, '').toLowerCase())
        .filter(Boolean))].slice(0, 30) : []
      return {
        registrar: registrar ? rdapEntityName(registrar) : '',
        rdapExpiryDate: rdapExpiry(registrar?.events) || rdapExpiry(data.events),
        nameservers,
        lookupAt: new Date().toISOString(),
        source: 'RDAP',
      }
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(lastError?.message || '公开域名信息查询失败')
}

async function lookupDomainPublicInfo(value) {
  const { ascii } = domainName(value)
  if (ascii.endsWith('.cn')) return lookupDomainCnnic(ascii)
  return lookupDomainRdap(ascii)
}

function checkResult(status, message, checkedAt, latencyMs = null, httpStatus = null) {
  return { status, message, checkedAt, latencyMs, httpStatus }
}

function probeTcpConnection(server) {
  const checkedAt = new Date().toISOString()
  if (!server.publicIp || !server.sshPort) {
    return Promise.resolve(checkResult('not-configured', '请先填写公网 IP 和 SSH 端口', checkedAt))
  }
  if (!net.isIP(server.publicIp)) {
    return Promise.resolve(checkResult('error', '公网 IP 格式无效', checkedAt))
  }
  return new Promise(resolve => {
    const started = Date.now()
    const socket = net.createConnection({ host: server.publicIp, port: Number(server.sshPort) })
    let settled = false
    function finish(status, message) {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(checkResult(status, message, checkedAt, Date.now() - started))
    }
    socket.setTimeout(5000)
    socket.once('connect', () => finish('ok', '端口可连接'))
    socket.once('timeout', () => finish('error', '连接超时'))
    socket.once('error', error => finish('error', error.code === 'ECONNREFUSED' ? '端口拒绝连接' : error.message || '连接失败'))
  })
}

async function probeWebsite(server) {
  const checkedAt = new Date().toISOString()
  if (!server.websiteUrl) return checkResult('not-configured', '请先填写网站检测地址', checkedAt)
  const started = Date.now()
  try {
    const response = await fetch(server.websiteUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Subscription Book/1.0' },
    })
    await response.body?.cancel().catch(() => {})
    const isReachable = response.ok || response.status === 401 || response.status === 403
    return checkResult(isReachable ? 'ok' : 'error', `HTTP ${response.status}`, checkedAt, Date.now() - started, response.status)
  } catch (error) {
    const message = error.name === 'TimeoutError' || error.name === 'AbortError' ? '请求超时' : error.message || '请求失败'
    return checkResult('error', message, checkedAt, Date.now() - started)
  }
}

const latestServerProbe = new Map()

function publicGateway(gateway) {
  return {
    id: gateway.id,
    name: gateway.name,
    website: gateway.website || '',
    note: gateway.note || '',
    endpoints: (gateway.endpoints || []).map(endpoint => ({
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      hasKey: Boolean(endpointApiKey(endpoint)),
      lastCheck: endpoint.lastCheck || null,
      latency: endpoint.latency || null,
      modelCount: endpoint.modelCount || 0,
      models: Array.isArray(endpoint.models) ? endpoint.models : [],
      error: endpoint.error || '',
    })),
  }
}

function endpointApiKey(endpoint) {
  const plainKey = typeof endpoint?.apiKey === 'string' ? endpoint.apiKey.trim() : ''
  if (plainKey) return plainKey
  if (!endpoint?.encryptedKey) return ''
  try { return safeStorage.decryptString(Buffer.from(endpoint.encryptedKey, 'base64')) } catch { return '' }
}

function sanitizeGatewayInput(input, savedGateways) {
  if (!Array.isArray(input)) throw new Error('中转站数据格式无效')
  const savedKeys = new Map()
  for (const gateway of savedGateways) {
    for (const endpoint of gateway.endpoints || []) savedKeys.set(endpoint.id, endpointApiKey(endpoint))
  }
  return input.map(gateway => ({
    id: String(gateway.id || Date.now()),
    name: String(gateway.name || '').trim() || '未命名中转站',
    website: String(gateway.website || '').trim(),
    note: String(gateway.note || '').trim(),
    endpoints: (gateway.endpoints || []).map(endpoint => {
      const apiKey = typeof endpoint.apiKey === 'string' ? endpoint.apiKey.trim() : ''
      if (apiKey && /[\r\n]/.test(apiKey)) throw new Error('API Key 格式无效')
      const savedKey = savedKeys.get(endpoint.id) || ''
      return {
        id: String(endpoint.id || Date.now()),
        name: String(endpoint.name || '').trim() || 'API 地址',
        url: String(endpoint.url || '').trim(),
        apiKey: apiKey || savedKey,
        lastCheck: endpoint.lastCheck || null,
        latency: endpoint.latency || null,
        modelCount: endpoint.modelCount || 0,
        models: Array.isArray(endpoint.models) ? endpoint.models.slice(0, 300) : [],
        error: endpoint.error || '',
      }
    }),
  }))
}

function curlConfigValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '')}"`
}

function modelsUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (base.endsWith('/models')) return base
  if (base.endsWith('/v1')) return `${base}/models`
  return `${base}/v1/models`
}

function parseModelNames(text) {
  let data
  try { data = JSON.parse(text) } catch { throw new Error('接口没有返回 JSON 模型列表') }
  const source = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : []
  const models = [...new Set(source.map(model => typeof model === 'string' ? model : model?.id || model?.name || model?.model).filter(Boolean).map(String))]
  if (!models.length) throw new Error('接口没有返回可识别的模型列表')
  return models.slice(0, 300)
}

async function probeModels(endpoint, apiKey) {
  const tempDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'subscription-book-models-'))
  const bodyPath = path.join(tempDir, 'body')
  try {
    const result = await new Promise((resolve, reject) => {
      const request = spawn(curlExecutable, ['-L', '--max-time', '15', '--connect-timeout', '6', '-sS', '-o', bodyPath, '-w', '%{http_code}\t%{time_starttransfer}', '-K', '-'], { windowsHide: true })
      let output = ''
      let errorOutput = ''
      request.stdout.on('data', chunk => { output += chunk.toString() })
      request.stderr.on('data', chunk => { errorOutput += chunk.toString() })
      request.stdin.end(`url = ${curlConfigValue(modelsUrl(endpoint.url))}\nheader = ${curlConfigValue(`Authorization: Bearer ${apiKey}`)}\nheader = ${curlConfigValue('Accept: application/json')}\nuser-agent = ${curlConfigValue('Subscription Book/1.0')}\n`)
      request.on('error', reject)
      request.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errorOutput.trim() || '检测请求失败')))
    })
    const [status, transfer] = result.split('\t').map(Number)
    const body = await fs.readFile(bodyPath, 'utf8')
    if (!status || status < 200 || status >= 300) {
      const reason = cleanBodySnippet(body)
      throw new Error(`服务器返回 ${status || '未知状态'}${reason ? `：${reason}` : ''}`)
    }
    const models = parseModelNames(body)
    return { latency: Math.max(1, Math.round((transfer || 0) * 1000)), models }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

ipcMain.handle('subscriptions:read', async () => {
  try {
    const content = await fs.readFile(storePath(), 'utf8')
    const records = JSON.parse(content)
    return Array.isArray(records) ? records : []
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
})

ipcMain.handle('subscriptions:save', async (_event, records) => {
  if (!Array.isArray(records)) throw new Error('订阅数据格式无效')
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(storePath(), JSON.stringify(records, null, 2), 'utf8')
  return true
})

ipcMain.handle('subscriptions:refresh', async (_event, link) => {
  if (!link || !/^https?:\/\//i.test(link)) {
    throw new Error('请先填写有效的订阅链接')
  }
  try {
    const host = new URL(link).hostname
    console.log('[subscriptions:refresh] start', { host })
    const response = await readResponseHeaders(link)
    const { status, headers } = parseHeaderBlock(response.headers)
    if (!status || status < 200 || status >= 300) {
      const reason = cleanBodySnippet(response.bodySnippet)
      throw new Error(`订阅服务器返回 ${status || '未知状态'}${reason ? `：${reason}` : ''}`)
    }
    const info = parseSubscriptionInfo(headers['subscription-userinfo'])
    const title = decodeTitle(headers['profile-title']) || titleFromDisposition(headers['content-disposition']) || fallbackName(link)
    const result = { ...info, name: title, website: headers['profile-web-page-url'] || null, updateInterval: Number(headers['profile-update-interval']) || null, refreshedAt: Date.now(), hasUsageInfo: Boolean(headers['subscription-userinfo']) }
    console.log('[subscriptions:refresh] success', { host, hasUsageInfo: result.hasUsageInfo })
    return result
  } catch (error) {
    console.error('[subscriptions:refresh] failed', { name: error.name, message: error.message })
    throw new Error(`读取失败：${error.message || '无法连接到订阅服务器'}`)
  }
})

ipcMain.handle('ai:read', async () => {
  const gateways = await readJsonFile(aiStorePath(), [])
  return Array.isArray(gateways) ? gateways.map(publicGateway) : []
})

ipcMain.handle('ai:copy-key', async (_event, gatewayId, endpointId) => {
  const gateways = await readJsonFile(aiStorePath(), [])
  const gateway = Array.isArray(gateways) && gateways.find(item => String(item.id) === String(gatewayId))
  if (!gateway) throw new Error('找不到这个中转站')

  const endpoint = Array.isArray(gateway.endpoints) && gateway.endpoints.find(item => String(item.id) === String(endpointId))
  if (!endpoint) throw new Error('找不到这个 API 地址')
  const apiKey = endpointApiKey(endpoint)
  if (!apiKey) throw new Error('这个 API 地址还没有保存 API Key')
  clipboard.writeText(apiKey)
  return true
})

ipcMain.handle('ai:save', async (_event, gateways) => {
  const saved = await readJsonFile(aiStorePath(), [])
  const sanitized = sanitizeGatewayInput(gateways, Array.isArray(saved) ? saved : [])
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(aiStorePath(), JSON.stringify(sanitized, null, 2), 'utf8')
  return sanitized.map(publicGateway)
})

ipcMain.handle('ai:probe', async (_event, gatewayId, endpointId) => {
  const gateways = await readJsonFile(aiStorePath(), [])
  const gateway = gateways.find(item => item.id === gatewayId)
  const endpoint = gateway?.endpoints?.find(item => item.id === endpointId)
  if (!endpoint) throw new Error('找不到这个 API 地址')
  const apiKey = endpointApiKey(endpoint)
  if (!apiKey) throw new Error('请先在编辑中保存 API Key')
  if (!/^https?:\/\//i.test(endpoint.url)) throw new Error('请填写有效的 API 地址')
  try {
    const result = await probeModels(endpoint, apiKey)
    endpoint.lastCheck = Date.now()
    endpoint.latency = result.latency
    endpoint.models = result.models
    endpoint.modelCount = result.models.length
    endpoint.error = ''
    await fs.writeFile(aiStorePath(), JSON.stringify(gateways, null, 2), 'utf8')
    return { endpointId, latency: result.latency, models: result.models, modelCount: result.models.length, lastCheck: endpoint.lastCheck, error: '' }
  } catch (error) {
    endpoint.lastCheck = Date.now()
    endpoint.error = error.message || '检测失败'
    await fs.writeFile(aiStorePath(), JSON.stringify(gateways, null, 2), 'utf8')
    throw error
  }
})

ipcMain.handle('domains:read', async () => {
  await domainWriteQueue.wait()
  return readRecordArray(domainStorePath(), '域名')
})

ipcMain.handle('domains:save', async (_event, records) => domainWriteQueue.run(async () => {
  const sanitized = sanitizeDomainInput(records)
  await serverWriteQueue.wait()
  const validServerIds = new Set((await readRecordArray(serverStorePath(), '云服务器')).map(server => server.id))
  for (const domain of sanitized) domain.serverIds = domain.serverIds.filter(id => validServerIds.has(id))
  await writeJsonAtomic(domainStorePath(), sanitized)
  return sanitized
}))

ipcMain.handle('domains:lookup', async (_event, name) => lookupDomainPublicInfo(name))

ipcMain.handle('servers:read', async () => {
  await serverWriteQueue.wait()
  return readRecordArray(serverStorePath(), '云服务器')
})

ipcMain.handle('servers:save', async (_event, records) => {
  const saved = await serverWriteQueue.run(async () => {
    const previous = await readRecordArray(serverStorePath(), '云服务器')
    const sanitized = sanitizeServerInput(records, previous)
    await writeJsonAtomic(serverStorePath(), sanitized)
    return sanitized
  })
  const validIds = new Set(saved.map(server => server.id))
  await domainWriteQueue.run(async () => {
    const domains = await readRecordArray(domainStorePath(), '域名')
    let changed = false
    for (const domain of domains) {
      if (!Array.isArray(domain.serverIds)) continue
      const remaining = domain.serverIds.filter(id => validIds.has(id))
      if (remaining.length !== domain.serverIds.length) {
        domain.serverIds = remaining
        changed = true
      }
    }
    if (changed) await writeJsonAtomic(domainStorePath(), domains)
  })
  return saved
})

ipcMain.handle('servers:probe', async (_event, serverId) => {
  await serverWriteQueue.wait()
  const id = textField(serverId, 100)
  const servers = await readRecordArray(serverStorePath(), '云服务器')
  const server = servers.find(record => record.id === id)
  if (!server) throw new Error('找不到这台云服务器')
  const probeId = randomUUID()
  latestServerProbe.set(id, probeId)
  const [tcpResult, httpResult] = await Promise.all([probeTcpConnection(server), probeWebsite(server)])
  try {
    return await serverWriteQueue.run(async () => {
      if (latestServerProbe.get(id) !== probeId) throw new Error('已有更新的检测，请查看最新结果')
      const current = await readRecordArray(serverStorePath(), '云服务器')
      const record = current.find(item => item.id === id)
      if (!record) throw new Error('这台云服务器已删除')
      if (record.publicIp !== server.publicIp || Number(record.sshPort || 0) !== Number(server.sshPort || 0) || record.websiteUrl !== server.websiteUrl) {
        throw new Error('检测期间配置已修改，请重新检测')
      }
      record.tcpResult = tcpResult
      record.httpResult = httpResult
      await writeJsonAtomic(serverStorePath(), current)
      return { id, tcpResult, httpResult }
    })
  } finally {
    if (latestServerProbe.get(id) === probeId) latestServerProbe.delete(id)
  }
})

function createWindow() {
  const win = new BrowserWindow({
    title: '订阅簿',
    width: 900,
    height: 650,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f5f5f7',
    titleBarStyle: 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (isDev && devServerUrl) win.loadURL(devServerUrl)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
