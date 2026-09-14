import express from "express"
import crypto from "node:crypto"
import path from "node:path"
import { z } from "zod"
import {
  paths,
  setup,
  listNotes,
  loadNote,
  readJson,
  config,
  saveConfig,
  withLock,
  hash,
} from "../kb/store.mjs"
import {
  capture,
  organize,
  saveDraft,
  approve,
  archive,
  restore,
  revise,
  weekly,
  synthesize,
  health,
} from "../kb/pipeline.mjs"
import { collect } from "../kb/collect.mjs"
import { importCloud } from "../kb/cloud.mjs"
import { aiStatus } from "../kb/ai.mjs"
import { relatedNotes } from "../kb/markdown.mjs"
import { buildPreview } from "../kb/build.mjs"

await setup()
const app = express(),
  token = crypto.randomBytes(32).toString("hex")
const port = Number(process.env.STUDIO_PORT || 4312)
let job = null
app.disable("x-powered-by")
app.use((req, res, next) => {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
    return res.status(403).json({ error: "Host rejected" })
  if (
    req.headers.origin &&
    ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)
  )
    return res.status(403).json({ error: "Origin rejected" })
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  )
  res.setHeader("Cache-Control", "no-store")
  if (req.method !== "GET" && req.headers["x-kb-token"] !== token)
    return res.status(403).json({ error: "Session token required" })
  next()
})
app.use(express.json({ limit: "600kb" }))
app.get("/favicon.ico", (_req, res) => res.status(204).end())
app.use(express.static(path.join(paths.root, "scripts/studio/public")))
const vendors = {
  "lucide.js": "lucide/dist/umd/lucide.min.js",
  "marked.js": "marked/lib/marked.esm.js",
  "purify.js": "dompurify/dist/purify.min.js",
}
app.get("/vendor/:name", (req, res) =>
  vendors[req.params.name]
    ? res.sendFile(path.join(paths.root, "node_modules", vendors[req.params.name]))
    : res.sendStatus(404),
)
app.get("/api/state", async (_req, res) => {
  const notes = Object.fromEntries(
    await Promise.all(
      ["inbox", "review", "published", "archive"].map(async (area) => [
        area,
        (await listNotes(area))
          .filter((n) => n.id !== "index")
          .map(({ id, meta, error }) => ({ id, meta, error, area })),
      ]),
    ),
  )
  const reviewing = new Set(notes.review.map((n) => n.id))
  notes.inbox = notes.inbox.filter((n) => !reviewing.has(n.id))
  const reports = Object.fromEntries(
    await Promise.all(
      ["collect", "github", "health"].map(async (name) => [
        name,
        await readJson(path.join(paths.reports, `${name}.json`), null),
      ]),
    ),
  )
  res.json({ token, notes, reports, config: await config(), ai: aiStatus(), job })
})
app.get("/api/notes/:area/:id", async (req, res) => {
  const note = await loadNote(req.params.area, req.params.id)
  const published = await listNotes("published")
  res.json({
    ...note,
    version: hash(note.raw),
    recommendations: relatedNotes(`${note.meta.title}\n${note.body}`, published, note.id),
  })
})
const captureSchema = z.object({
  title: z.string().max(160).default(""),
  body: z.string().max(150000).default(""),
  url: z.string().max(2000).default(""),
  kind: z.enum(["manual", "web", "wechat"]).default("manual"),
})
app.post("/api/capture", async (req, res) =>
  res.json(await withLock(() => capture(captureSchema.parse(req.body)))),
)
app.post("/api/notes/:area/:id", async (req, res) => {
  const values = z
    .object({
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(150000),
      summary: z.string().max(1200),
      category: z.string().max(50),
      tags: z.array(z.string().max(40)).max(12),
      version: z.string().min(1),
    })
    .parse(req.body)
  res.json(await withLock(() => saveDraft(req.params.area, req.params.id, values)))
})
app.post("/api/action", async (req, res) => {
  const { action, id, area, confirmDuplicate, version } = z
    .object({
      action: z.enum(["organize", "approve", "archive", "restore", "revise"]),
      id: z.string(),
      area: z.string().optional(),
      confirmDuplicate: z.boolean().default(false),
      version: z.string().optional(),
    })
    .parse(req.body)
  if (action === "approve" && !version)
    return res.status(400).json({ error: "缺少审核版本，请刷新笔记" })
  const work = {
    organize: () => organize(id),
    approve: () => approve(id, { confirmDuplicate, version }),
    archive: () => archive(area, id),
    restore: () => restore(id),
    revise: () => revise(id),
  }[action]
  res.json((await withLock(work)) ?? { ok: true })
})
app.post("/api/jobs", async (req, res) => {
  const { task, title, ids } = z
    .object({
      task: z.enum(["collect", "health", "weekly", "topic", "import-cloud", "build"]),
      title: z.string().max(160).default("专题整理"),
      ids: z.array(z.string()).max(12).default([]),
    })
    .parse(req.body)
  if (job?.status === "running") return res.status(409).json({ error: "已有任务运行中" })
  job = { task, status: "running", startedAt: new Date().toISOString() }
  const work = {
    build: buildPreview,
    collect,
    health,
    weekly,
    topic: () => synthesize(title, ids),
    "import-cloud": importCloud,
  }[task]
  res.json(job)
  withLock(work)
    .then((result) => {
      job = { ...job, status: "done", result, finishedAt: new Date().toISOString() }
    })
    .catch((error) => {
      job = { ...job, status: "error", error: error.message, finishedAt: new Date().toISOString() }
    })
})
app.post("/api/config", async (req, res) => res.json(await withLock(() => saveConfig(req.body))))
app.use((err, _req, res, _next) =>
  res.status(err.code === "ENOENT" ? 404 : 400).json({
    error:
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : err.message,
  }),
)
app.listen(port, "127.0.0.1", () => console.log(`PersonBlog studio: http://127.0.0.1:${port}`))
