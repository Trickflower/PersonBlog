import dns from "node:dns/promises"
import net from "node:net"
import http from "node:http"
import https from "node:https"

const blocked = new net.BlockList()
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  blocked.addSubnet(ip, prefix, "ipv4")
for (const [ip, prefix] of [
  ["::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["64:ff9b::", 96],
])
  blocked.addSubnet(ip, prefix, "ipv6")
export function isPublicIp(address) {
  const family = net.isIP(address)
  if (!family) return false
  if (family === 6 && /^::ffff:/i.test(address)) return false
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6")
}

export function canonicalUrl(value) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("只接受不含账号密码的 HTTP / HTTPS 链接")
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("不支持该端口")
  url.hash = ""
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  return url.href
}

// Pin the connection to validated DNS results, including every redirect.
export async function publicRequest(value, options = {}, redirects = 0) {
  const url = new URL(canonicalUrl(value))
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true })
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
    throw new Error("不允许访问本机、内网或保留地址")
  const result = await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          "User-Agent": "PersonBlog/1.0 (+knowledge-reader)",
          "Accept-Encoding": "identity",
          ...options.headers,
        },
        lookup: (_host, opts, cb) =>
          opts.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family),
      },
      (response) => {
        const chunks = []
        let size = 0
        response.on("data", (chunk) => {
          size += chunk.length
          if (size > (options.maxBytes ?? 2_000_000)) request.destroy(new Error("页面超过大小限制"))
          else chunks.push(chunk)
        })
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
            url: url.href,
          }),
        )
        response.on("error", reject)
      },
    )
    const timer = setTimeout(() => request.destroy(new Error("访问超时")), options.timeout ?? 15000)
    request.on("close", () => clearTimeout(timer))
    request.on("error", reject)
    if (options.body) request.write(options.body)
    request.end()
  })
  if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
    if (redirects >= 4) throw new Error("重定向过多")
    const next = new URL(result.headers.location, url)
    const credentials = Object.keys(options.headers ?? {}).some((key) =>
      /authorization|token|key|cookie/i.test(key),
    )
    if (options.body || (credentials && next.origin !== url.origin))
      throw new Error("已阻止带凭据的重定向")
    return publicRequest(next.href, options, redirects + 1)
  }
  return result
}

export async function getJson(url, options = {}) {
  const result = await publicRequest(url, options)
  if (result.status < 200 || result.status >= 300)
    throw new Error(`请求失败 HTTP ${result.status} (${new URL(url).hostname})`)
  return JSON.parse(result.text)
}
