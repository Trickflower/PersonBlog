import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { parseDocument, stringify } from "yaml"
import { z } from "zod"

export const ROOT = process.env.KB_ROOT || fileURLToPath(new URL("../../", import.meta.url))
export const paths = {
  root: ROOT,
  inbox: path.join(ROOT, "vault/inbox"),
  review: path.join(ROOT, "vault/review"),
  archive: path.join(ROOT, "vault/archive"),
  published: path.join(ROOT, "vault/published"),
  state: path.join(ROOT, "private/state"),
  reports: path.join(ROOT, "private/reports"),
}
export const iso = () => new Date().toISOString()
export const day = () => iso().slice(0, 10)
export const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 20)

export async function setup() {
  for (const dir of Object.values(paths)) await fs.mkdir(dir, { recursive: true })
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw error
  }
}

export async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temp, content, "utf8")
  await fs.rename(temp, file)
}
export const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + "\n")

export function parseNote(raw) {
  let body = raw.replace(/^\uFEFF/, "")
  let meta = {}
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (match) {
    const doc = parseDocument(match[1], { schema: "core", uniqueKeys: true })
    if (doc.errors.length) throw new Error(`Markdown 属性格式错误：${doc.errors[0].message}`)
    meta = doc.toJS({ maxAliasCount: 30 }) ?? {}
    if (!meta || Array.isArray(meta) || typeof meta !== "object")
      throw new Error("Markdown 属性必须是对象")
    body = body.slice(match[0].length)
  }
  return { meta, body: body.trim() }
}

export function serializeNote(meta, body) {
  return `---\n${stringify(meta, { lineWidth: 0 }).trim()}\n---\n\n${body.trim()}\n`
}

export function notePath(area, id) {
  if (!["inbox", "review", "archive", "published"].includes(area)) throw new Error("未知目录")
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} _.-]{0,110}$/u.test(id) ||
    /[. ]$/.test(id) ||
    /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(id)
  )
    throw new Error("无效笔记 ID")
  return path.join(paths[area], `${id}.md`)
}

export async function loadNote(area, id) {
  const raw = await fs.readFile(notePath(area, id), "utf8")
  const parsed = parseNote(raw)
  if (typeof parsed.meta.title !== "string" || !parsed.meta.title.trim())
    parsed.meta.title = parsed.body.match(/^#\s+(.+)$/m)?.[1] || id
  const tags = parsed.meta.tags
  parsed.meta.tags = (
    Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[,，\s]+/) : []
  ).filter((t) => typeof t === "string" && t.trim())
  if (!Array.isArray(parsed.meta.related)) parsed.meta.related = []
  return { id, area, raw, ...parsed }
}

export async function listNotes(area) {
  await setup()
  const names = (await fs.readdir(paths[area])).filter((n) => n.endsWith(".md"))
  const notes = []
  for (const name of names) {
    try {
      notes.push(await loadNote(area, name.slice(0, -3)))
    } catch (error) {
      notes.push({
        id: name.slice(0, -3),
        area,
        meta: { title: name },
        body: "",
        error: error.message,
      })
    }
  }
  return notes.sort((a, b) =>
    String(b.meta.created ?? "").localeCompare(String(a.meta.created ?? "")),
  )
}

export async function saveNote(area, id, meta, body) {
  await atomicWrite(notePath(area, id), serializeNote(meta, body))
  return loadNote(area, id)
}

const configSchema = z.object({
  site: z.object({
    title: z.string(),
    description: z.string(),
    baseUrl: z.string(),
    repository: z.string(),
    author: z.string(),
  }),
  categories: z.array(z.string()).min(1),
  sources: z.object({
    rss: z.array(z.string().url()).max(20),
    github: z.object({
      enabled: z.boolean(),
      days: z.number().int().min(1).max(90),
      minStars: z.number().int().min(0),
      limit: z.number().int().min(1).max(30),
      topics: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(5),
    }),
    search: z.object({
      provider: z.enum(["disabled", "brave", "tavily"]),
      queries: z.array(z.string().max(200)).max(10),
      limit: z.number().int().min(1).max(10),
    }),
  }),
  limits: z.object({
    maxItemsPerRun: z.number().int().min(1).max(50),
    maxAiPerRun: z.number().int().min(0).max(30),
    maxSourceChars: z.number().int().min(500).max(60000),
    staleDays: z.number().int().min(1),
    maxLinksPerRun: z.number().int().min(1).max(200),
  }),
})
export const configFile = path.join(ROOT, "config/knowledge.json")
export async function config() {
  return configSchema.parse(await readJson(configFile))
}
export async function saveConfig(value) {
  const valid = configSchema.parse(value)
  await writeJson(configFile, valid)
  return valid
}

export async function audit(action, data = {}) {
  await setup()
  await fs.appendFile(
    path.join(paths.state, "audit.jsonl"),
    JSON.stringify({ at: iso(), action, ...data }) + "\n",
  )
}

export async function withLock(work) {
  await setup()
  const file = path.join(paths.state, "operation.lock")
  let handle
  try {
    handle = await fs.open(file, "wx")
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "已有任务正在运行，请稍后重试。若进程异常退出，请先确认无运行中的任务，再移除 private/state/operation.lock。",
      )
    throw error
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: iso() }))
    return await work()
  } finally {
    await handle.close()
    await fs.unlink(file).catch(() => {})
  }
}
