import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import {
  config,
  paths,
  setup,
  iso,
  day,
  hash,
  saveNote,
  loadNote,
  listNotes,
  notePath,
  audit,
  writeJson,
  readJson,
} from "./store.mjs"
import { publicRequest, canonicalUrl } from "./network.mjs"
import { cleanMarkdown, extractLinks, relatedNotes, similarity } from "./markdown.mjs"
import { aiStatus, generateNote } from "./ai.mjs"

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
turndown.addRule("code", {
  filter: (node) => node.nodeName === "PRE",
  replacement: (_content, node) => {
    const code = node.querySelector("code") || node
    const language = (code.className?.match(/language-([a-zA-Z0-9_-]+)/) ?? [])[1] || ""
    const fence = "`".repeat(
      Math.max(3, ...[...code.textContent.matchAll(/`+/g)].map((m) => m[0].length + 1)),
    )
    return `\n\n${fence}${language}\n${code.textContent}\n${fence}\n\n`
  },
})

export async function extractPage(url) {
  const response = await publicRequest(url)
  if (response.status < 200 || response.status >= 300)
    throw new Error(`网页收录失败 HTTP ${response.status}`)
  if (/text\/plain|text\/markdown/.test(response.headers["content-type"] || ""))
    return { title: new URL(url).hostname, body: cleanMarkdown(response.text), url: response.url }
  if (!/html/i.test(response.headers["content-type"] || ""))
    throw new Error("该链接不是 HTML 或文本页面，请粘贴正文")
  const dom = new JSDOM(response.text, { url: response.url })
  try {
    const article = new Readability(dom.window.document).parse()
    if (!article?.textContent || article.textContent.trim().length < 60)
      throw new Error("无法提取正文（可能需要登录），请粘贴正文收录")
    return {
      title: article.title,
      body: cleanMarkdown(turndown.turndown(article.content)),
      url: response.url,
    }
  } finally {
    dom.window.close()
  }
}

export async function capture({ title = "", body = "", url = "", kind = "manual", metadata = {} }) {
  await setup()
  let source = url ? canonicalUrl(url) : ""
  if (source && !body.trim()) {
    const page = await extractPage(source)
    source = canonicalUrl(page.url)
    body = page.body
    title ||= page.title
  }
  if (!body.trim()) throw new Error("请填写正文或有效网页链接")
  if (body.length > 150000) throw new Error("单篇内容不能超过 150000 字符")
  const fingerprint = hash(body.trim().replace(/\s+/g, " "))
  for (const area of ["inbox", "review", "published", "archive"]) {
    const existing = (await listNotes(area)).find(
      (n) => (source && n.meta.source === source) || n.meta.fingerprint === fingerprint,
    )
    if (existing) return { ...existing, duplicate: true }
  }
  const id = `${kind === "manual" ? "note" : "source"}-${source ? hash(source) : crypto.randomUUID().slice(0, 12)}`
  const note = await saveNote(
    "inbox",
    id,
    {
      ...metadata,
      title:
        title.trim() ||
        body
          .split("\n")
          .find((line) => line.trim())
          ?.replace(/^#+\s*/, "")
          .slice(0, 100) ||
        "未命名笔记",
      created: iso(),
      updated: iso(),
      source,
      kind,
      fingerprint,
      status: "inbox",
      publish: false,
    },
    cleanMarkdown(body),
  )
  await audit("capture", { id, kind })
  return note
}

export async function organize(id, { force = false } = {}) {
  const raw = await loadNote("inbox", id)
  const already = (await listNotes("review")).find((n) => n.id === id)
  if (already && !force) return { ...already, skipped: true }
  const cfg = await config()
  const published = (await listNotes("published")).filter(
    (n) => n.meta.publish === true && !n.error,
  )
  const related = relatedNotes(`${raw.meta.title}\n${raw.body}`, published)
  let result,
    mode = "rules"
  const status = aiStatus()
  if (status.provider !== "disabled") {
    if (!status.enabled) throw new Error("AI 配置不完整；原始内容保留在收件箱")
    result = await generateNote({
      title: raw.meta.title,
      text: raw.body.slice(0, cfg.limits.maxSourceChars),
      categories: cfg.categories,
      candidates: related.map((r) => ({
        id: r.id,
        title: r.title,
        summary: published.find((n) => n.id === r.id)?.meta.summary ?? "",
      })),
    })
    mode = "ai"
  } else {
    const tags = [
      ...new Set([
        ...(raw.meta.tags ?? []),
        ...(raw.body.match(
          /\b(?:GitHub|Python|JavaScript|TypeScript|Markdown|Obsidian|Quartz|Docker|React|AI)\b/gi,
        ) ?? []),
      ]),
    ].slice(0, 6)
    result = {
      title: raw.meta.title,
      summary: raw.body
        .replace(/```[\s\S]*?```/g, "")
        .replace(/[#*>`\[\]]/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 220),
      category: raw.meta.category || (raw.meta.kind === "github" ? "项目观察" : "技术"),
      tags,
      body: raw.body,
      related: related.filter((r) => r.score >= 0.16).map((r) => r.id),
    }
  }
  const relationIds = [...new Set(result.related)].filter((id) =>
    published.some((n) => n.id === id),
  )
  const similar = related.filter((r) => r.score >= 0.65)
  const meta = {
    ...raw.meta,
    title: result.title,
    summary: result.summary,
    description: result.summary,
    category: result.category,
    tags: result.tags,
    related: relationIds,
    similar,
    updated: iso(),
    organizedAt: iso(),
    status: "review",
    publish: false,
    organizer: mode,
    inputTruncated: raw.body.length > cfg.limits.maxSourceChars && mode === "ai",
  }
  const note = await saveNote("review", id, meta, cleanMarkdown(result.body))
  await audit("organize", { id, mode })
  return note
}

export async function saveDraft(
  area,
  id,
  { title, body, summary = "", tags = [], category = "思考", version },
) {
  if (!["inbox", "review"].includes(area)) throw new Error("只有收件箱和待审核稿可以编辑")
  const old = await loadNote(area, id)
  if (version && hash(old.raw) !== version)
    throw new Error("笔记已在其他窗口或 Obsidian 中修改，请刷新后再保存")
  if (!title.trim() || !body.trim()) throw new Error("标题和正文不能为空")
  return saveNote(
    area,
    id,
    {
      ...old.meta,
      title: title.trim(),
      summary,
      description: summary,
      tags,
      category,
      updated: iso(),
      status: area,
      publish: false,
    },
    cleanMarkdown(body),
  )
}

export async function approve(id, { confirmDuplicate = false, version } = {}) {
  const draft = await loadNote("review", id)
  if (version && version !== hash(draft.raw)) throw new Error("待审核内容已修改，请刷新后重新审核")
  if (!draft.meta.title?.trim() || !draft.body.trim()) throw new Error("标题和正文不能为空")
  const published = (await listNotes("published")).filter((n) => !n.error)
  const normalizedId = (value) => value.replace(/\s/g, "-").toLowerCase()
  if (published.some((n) => n.id !== id && normalizedId(n.id) === normalizedId(id)))
    throw new Error("发布路径与已有文章冲突，请更改文件名")
  const previous = published.find((n) => n.id === id)
  if (previous && (!draft.meta.revisionOf || draft.meta.revisionHash !== hash(previous.raw)))
    throw new Error("已存在同名文章或原文已有修改，请重新建立修订稿")
  const similar = relatedNotes(`${draft.meta.title}\n${draft.body}`, published, id).filter(
    (r) => r.score >= 0.65,
  )
  if (similar.length && !confirmDuplicate) return { requiresConfirmation: true, similar }
  const validRelated = (draft.meta.related ?? []).filter((id) =>
    published.some((n) => n.id === id && n.meta.publish === true),
  )
  let body = draft.body
  if (validRelated.length)
    body += `\n\n## 相关笔记\n\n${validRelated.map((ref) => `- [[${ref}|${published.find((n) => n.id === ref).meta.title}]]`).join("\n")}`
  if (draft.meta.source && !extractLinks(body).includes(draft.meta.source))
    body += `\n\n## 来源\n\n- [原始资料](${canonicalUrl(draft.meta.source)})`
  const { revisionOf, revisionHash, similar: _similar, ...metadata } = draft.meta
  const note = await saveNote(
    "published",
    id,
    {
      ...metadata,
      related: validRelated,
      status: "published",
      publish: true,
      approvedAt: iso(),
      publishedAt: previous?.meta.publishedAt || iso(),
      updated: iso(),
    },
    cleanMarkdown(body),
  )
  await fs.rename(notePath("review", id), notePath("archive", `${id}-review`))
  await fs.rename(notePath("inbox", id), notePath("archive", `${id}-source`)).catch((error) => {
    if (error.code !== "ENOENT") throw error
  })
  await audit("approve", { id })
  return note
}

export async function revise(id) {
  const old = await loadNote("published", id)
  const existing = (await listNotes("review")).find((n) => n.id === id)
  if (existing) return existing
  return saveNote(
    "review",
    id,
    {
      ...old.meta,
      revisionOf: id,
      revisionHash: hash(old.raw),
      status: "review",
      publish: false,
      updated: iso(),
      related: [],
    },
    old.body,
  )
}

export async function archive(area, id) {
  if (!["inbox", "review"].includes(area)) throw new Error("只有未发布笔记可以归档")
  const note = await loadNote(area, id)
  await saveNote(
    "archive",
    `${id}-${Date.now()}`,
    { ...note.meta, status: "archived", archivedAt: iso(), publish: false },
    note.body,
  )
  await fs.unlink(notePath(area, id))
  if (area === "review")
    await fs.rename(notePath("inbox", id), notePath("archive", `${id}-source`)).catch((e) => {
      if (e.code !== "ENOENT") throw e
    })
  await audit("archive", { area, id })
}

export async function restore(id) {
  const note = await loadNote("archive", id)
  const newId = `note-${crypto.randomUUID().slice(0, 12)}`
  return saveNote(
    "inbox",
    newId,
    { ...note.meta, status: "inbox", publish: false, restoredFrom: id, updated: iso() },
    note.body,
  )
}

export async function weekly(now = new Date()) {
  const end = new Date(now)
  end.setUTCHours(0, 0, 0, 0)
  end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 7)
  const id = `weekly-${start.toISOString().slice(0, 10)}`
  for (const area of ["review", "published"]) {
    const n = (await listNotes(area)).find((n) => n.id === id)
    if (n) return { ...n, skipped: true }
  }
  const notes = (await listNotes("published")).filter(
    (n) =>
      n.meta.publish === true &&
      !n.id.startsWith("weekly-") &&
      new Date(n.meta.publishedAt) >= start &&
      new Date(n.meta.publishedAt) < end,
  )
  if (!notes.length) return { skipped: true, message: "上一个完整周没有新增已审核文章" }
  const title = `本周新增知识 · ${start.toISOString().slice(0, 10)}`
  const body = `本期记录 ${start.toISOString().slice(0, 10)} 至 ${new Date(end - 86400000).toISOString().slice(0, 10)}（UTC）首次发布的 ${notes.length} 篇笔记。\n\n${notes.map((n) => `## [[${n.id}|${n.meta.title}]]\n\n${n.meta.summary || n.meta.description || ""}`).join("\n\n")}`
  return saveNote(
    "review",
    id,
    {
      title,
      summary: `上周新增 ${notes.length} 篇笔记`,
      created: iso(),
      updated: iso(),
      tags: ["周记"],
      category: "周记",
      status: "review",
      publish: false,
      kind: "weekly",
      related: [],
      organizer: "rules",
    },
    body,
  )
}

export async function synthesize(title, ids) {
  const cfg = await config()
  const notes = (await listNotes("published")).filter(
    (n) => ids.includes(n.id) && n.meta.publish === true && !n.error,
  )
  if (notes.length < 2) throw new Error("至少选择两篇已发布笔记")
  let body,
    summary,
    mode = "rules"
  if (aiStatus().provider !== "disabled") {
    const result = await generateNote({
      title,
      categories: cfg.categories,
      candidates: notes.map((n) => ({ id: n.id, title: n.meta.title })),
      text: notes
        .map(
          (n) =>
            `笔记 ${n.id}: ${n.meta.title}\n${n.body.slice(0, Math.floor(cfg.limits.maxSourceChars / notes.length))}`,
        )
        .join("\n\n"),
      task: "围绕指定主题综合多篇笔记，解释共同点、差异与待解决问题，用 [[ID]] 引用对应笔记，不推断原文没有的事实",
    })
    body = result.body
    summary = result.summary
    mode = "ai"
  } else {
    summary = `围绕「${title}」汇集 ${notes.length} 篇笔记。`
    body = `${summary}\n\n${notes.map((n) => `## [[${n.id}|${n.meta.title}]]\n\n${n.meta.summary || n.meta.description || n.body.slice(0, 250)}`).join("\n\n")}\n\n## 我的综合理解\n\n待补充。`
  }
  const id = `topic-${day()}-${crypto.randomUUID().slice(0, 6)}`
  return saveNote(
    "review",
    id,
    {
      title,
      summary,
      description: summary,
      created: iso(),
      updated: iso(),
      category: "专题",
      tags: ["专题"],
      status: "review",
      publish: false,
      organizer: mode,
      related: [],
      sourceNotes: notes.map((n) => n.id),
    },
    cleanMarkdown(body),
  )
}

export async function health() {
  const cfg = await config(),
    notes = (await listNotes("published")).filter((n) => !n.error && n.meta.publish === true)
  const byUrl = new Map()
  for (const note of notes)
    for (const link of extractLinks(note.body))
      byUrl.set(link, [...new Set([...(byUrl.get(link) || []), note.id])])
  const entries = [...byUrl.entries()]
  const cursorFile = path.join(paths.state, "health-cursor.json")
  const cursor = (await readJson(cursorFile, { offset: 0 })).offset % (entries.length || 1)
  const rotated = [...entries.slice(cursor), ...entries.slice(0, cursor)]
  const links = [],
    selected = rotated.slice(0, cfg.limits.maxLinksPerRun)
  for (const [url, ids] of selected) {
    try {
      let response = await publicRequest(url, { method: "HEAD", timeout: 8000 })
      if ([405, 501].includes(response.status))
        response = await publicRequest(url, { timeout: 8000 })
      links.push({
        url,
        notes: ids,
        status: response.status,
        state: [404, 410].includes(response.status)
          ? "broken"
          : response.status >= 200 && response.status < 400
            ? "ok"
            : "unverified",
        finalUrl: response.url,
      })
    } catch (error) {
      links.push({ url, notes: ids, state: "unverified", error: error.message })
    }
  }
  const stale = notes
    .filter(
      (n) =>
        Date.now() - new Date(n.meta.lastVerified || n.meta.updated || n.meta.created).getTime() >
        cfg.limits.staleDays * 86400000,
    )
    .map((n) => ({
      id: n.id,
      title: n.meta.title,
      lastVerified: n.meta.lastVerified || n.meta.updated || n.meta.created,
    }))
  const duplicates = []
  for (let i = 0; i < notes.length; i++)
    for (let j = i + 1; j < notes.length; j++) {
      const score = similarity(notes[i].body, notes[j].body)
      if (score >= 0.65)
        duplicates.push({ a: notes[i].id, b: notes[j].id, score: Number(score.toFixed(3)) })
    }
  const report = {
    at: iso(),
    checked: selected.length,
    remaining: byUrl.size - selected.length,
    links,
    stale,
    duplicates,
    recommendations: notes.map((n) => ({
      id: n.id,
      related: relatedNotes(`${n.meta.title}\n${n.body}`, notes, n.id),
    })),
  }
  await writeJson(path.join(paths.reports, "health.json"), report)
  await writeJson(cursorFile, { offset: (cursor + selected.length) % (entries.length || 1) })
  return report
}
