import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
await fs.mkdir(path.join(root, "private/test-runs"), { recursive: true })
process.env.KB_ROOT = await fs.mkdtemp(path.join(root, "private/test-runs/core-"))
process.env.AI_PROVIDER = "disabled"
await fs.mkdir(path.join(process.env.KB_ROOT, "config"), { recursive: true })
await fs.copyFile(
  path.join(root, "config/knowledge.json"),
  path.join(process.env.KB_ROOT, "config/knowledge.json"),
)
const store = await import("../scripts/kb/store.mjs")
const pipeline = await import("../scripts/kb/pipeline.mjs")
const markdown = await import("../scripts/kb/markdown.mjs")
const network = await import("../scripts/kb/network.mjs")
const { parseTrending } = await import("../scripts/kb/collect.mjs")
await store.setup()

test("delete published notes checks version, preserves private revisions, and keeps a recoverable copy", async () => {
  const id = "deletion-fixture"
  const article = await store.saveNote(
    "published",
    id,
    { title: "删除测试", publish: true },
    "已发布正文",
  )
  const revision = await store.saveNote(
    "review",
    id,
    { title: "私密修订", publish: false },
    "待审核正文",
  )
  const source = await store.saveNote(
    "inbox",
    id,
    { title: "私密原稿", publish: false },
    "原稿正文",
  )
  await assert.rejects(pipeline.deletePublished(id), /缺少文章版本/)
  await assert.rejects(pipeline.deletePublished(id, { version: "stale" }), /已修改/)
  await assert.rejects(pipeline.deletePublished("index", { version: "any" }), /首页不能删除/)
  await assert.rejects(
    pipeline.deletePublished("../review/deletion-fixture", { version: "any" }),
    /无效笔记 ID/,
  )
  assert.equal((await store.loadNote("published", id)).raw, article.raw)
  await store.withLock(() => pipeline.deletePublished(id, { version: store.hash(article.raw) }))
  await assert.rejects(store.loadNote("published", id), { code: "ENOENT" })
  assert.equal((await store.loadNote("review", id)).raw, revision.raw)
  assert.equal((await store.loadNote("inbox", id)).raw, source.raw)
  const trash = path.join(store.paths.root, "private/trash")
  const backups = (await fs.readdir(trash)).filter((name) => name.endsWith(`-${id}.md`))
  assert.equal(backups.length, 1)
  assert.equal(await fs.readFile(path.join(trash, backups[0]), "utf8"), article.raw)
  await assert.rejects(pipeline.deletePublished(id, { version: store.hash(article.raw) }), {
    code: "ENOENT",
  })
})

test("monthly Trending records preserve the reported period instead of total stars", () => {
  const html =
    '<article class="Box-row"><h2><a href="/owner/project">project</a></h2><a href="/owner/project/stargazers">12,345</a><span class="d-inline-block float-sm-right">2,100 stars this month</span></article>'
  assert.deepEqual(parseTrending(html), [
    { repo: "owner/project", stars: 12345, trendingMonthlyStars: 2100 },
  ])
  assert.deepEqual(parseTrending(html.replace("this month", "today")), [])
  assert.deepEqual(parseTrending("<h1>Temporarily unavailable</h1>"), [])
})

test("Markdown metadata uses safe YAML and preserves code / Unicode", () => {
  const body = "## 我的笔记\n\n```js\nconst value = '<script>'\n```\n\n[[connected-notes|关联]]"
  const raw = store.serializeNote(
    { title: "中文: 标题", tags: ["AI", "工具"], publish: false },
    body,
  )
  assert.deepEqual(store.parseNote(raw), {
    meta: { title: "中文: 标题", tags: ["AI", "工具"], publish: false },
    body,
  })
  assert.throws(() => store.parseNote("---\ntitle: a\ntitle: b\n---\ntext"))
  assert.equal(markdown.cleanMarkdown(body), body)
  assert.ok(!markdown.cleanMarkdown("<script>alert(1)</script>").includes("<script>"))
  assert.ok(!markdown.cleanMarkdown("[bad](javascript:alert(1))").includes("javascript:"))
})

test("paths allow Chinese filenames and reject traversal / Windows devices", () => {
  assert.ok(store.notePath("inbox", "我的 笔记").endsWith("我的 笔记.md"))
  for (const id of ["../secret", "a/b", "a\\b", "C:\\secret", "CON", "NUL.txt", "trailing."])
    assert.throws(() => store.notePath("inbox", id))
  assert.throws(() => store.notePath("state", "secret"))
})

test("plain Obsidian Markdown infers a title and accepts comma-separated tags", async () => {
  await fs.writeFile(
    store.notePath("inbox", "我的临时笔记"),
    "# 临时想到的标题\n\n记录一个具体问题。",
  )
  const plain = await store.loadNote("inbox", "我的临时笔记")
  assert.equal(plain.meta.title, "临时想到的标题")
  const tagged = await store.saveNote(
    "inbox",
    "tagged-note",
    { title: "标签", tags: "Markdown, 工具" },
    "正文",
  )
  assert.deepEqual(tagged.meta.tags, ["Markdown", "工具"])
})

test("approval rejects a changed review version and colliding public slugs", async () => {
  const reviewed = await store.saveNote(
    "review",
    "versioned-note",
    { title: "需要精确审核", publish: false },
    "先前看到的正文。",
  )
  await store.saveNote("review", "versioned-note", reviewed.meta, "另一个编辑器刚刚修改的正文。")
  await assert.rejects(
    pipeline.approve("versioned-note", { version: store.hash(reviewed.raw) }),
    /已修改/,
  )
  await store.saveNote(
    "published",
    "same-path",
    { title: "原有页面", publish: true },
    "保留原有页面。",
  )
  await store.saveNote(
    "review",
    "same path",
    { title: "路径冲突", publish: false },
    "这篇不应覆盖原来的文章。",
  )
  await assert.rejects(pipeline.approve("same path"), /路径.*冲突/)
  await fs.unlink(store.notePath("published", "same-path"))
})

test("public fetching blocks loopback, private and mapped addresses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.3.4.5",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "::127.0.0.1",
    "fc00::1",
  ])
    assert.equal(network.isPublicIp(ip), false, ip)
  assert.equal(network.isPublicIp("8.8.8.8"), true)
  assert.equal(network.isPublicIp("2606:4700:4700::1111"), true)
  await assert.rejects(network.publicRequest("http://127.0.0.1/"), /不允许/)
  assert.throws(() => network.canonicalUrl("file:///secret"))
  assert.throws(() => network.canonicalUrl("https://user:pass@example.com"))
  assert.equal(
    network.canonicalUrl("https://example.com/a?utm_source=test&b=1#h"),
    "https://example.com/a?b=1",
  )
})

test("Chinese similarity detects content even without spaces", () => {
  assert.ok(
    markdown.similarity(
      "知识管理需要记录笔记，链接关联已有知识",
      "知识管理与记录笔记，建立已有知识的关联",
    ) > 0.5,
  )
  assert.equal(markdown.similarity("知识管理笔记关联", "tomato cooking recipe"), 0)
  assert.deepEqual(
    markdown.extractLinks("```md\n[not](https://ignored.test)\n```\n[yes](https://example.com)"),
    ["https://example.com"],
  )
})

let draftId
test("capture -> organize -> review -> approval keeps drafts out of public", async () => {
  const capture = await pipeline.capture({
    title: "实际操作笔记",
    body: "## 方法\n\n先记录自己的观察，再通过实验建立结论。\n\n```js\nconsole.log(42)\n```",
  })
  draftId = capture.id
  assert.equal(capture.area, "inbox")
  assert.equal((await store.listNotes("published")).length, 0)
  const draft = await pipeline.organize(draftId)
  assert.equal(draft.meta.publish, false)
  assert.equal(draft.meta.organizer, "rules")
  assert.equal((await store.listNotes("published")).length, 0)
  const modified = await pipeline.saveDraft("review", draftId, {
    title: "经过审核的实验记录",
    body: draft.body + "\n\n我的观察：运行输出 42。",
    version: store.hash(draft.raw),
  })
  await assert.rejects(
    pipeline.saveDraft("review", draftId, {
      title: "stale",
      body: "stale",
      version: store.hash(draft.raw),
    }),
    /其他窗口/,
  )
  assert.equal((await pipeline.organize(draftId)).skipped, true)
  assert.equal((await store.loadNote("review", draftId)).body, modified.body)
  const result = await pipeline.approve(draftId)
  assert.equal(result.meta.publish, true)
  assert.ok(result.meta.approvedAt)
  assert.equal(result.meta.status, "published")
  assert.ok(result.body.includes("console.log(42)"))
  await assert.rejects(store.loadNote("review", draftId), { code: "ENOENT" })
  assert.ok((await store.listNotes("archive")).length >= 2)
})

test("duplicate sources normalize trackers and archived captures remain recognized", async () => {
  const first = await pipeline.capture({
    title: "source",
    url: "https://example.com/a?utm_source=rss",
    body: "Source reading with a repeatable observation.",
  })
  const second = await pipeline.capture({
    title: "source again",
    url: "https://example.com/a#part",
    body: "Changed text",
  })
  assert.equal(second.duplicate, true)
  assert.equal(second.id, first.id)
  await pipeline.archive("inbox", first.id)
  const third = await pipeline.capture({ url: "https://example.com/a", body: "Different text" })
  assert.equal(third.duplicate, true)
})

test("revisions preserve first publication time and reject stale approvals", async () => {
  const old = await store.loadNote("published", draftId)
  await pipeline.revise(draftId)
  await store.saveNote(
    "published",
    draftId,
    { ...old.meta, updated: store.iso() },
    old.body + "\n\n外部编辑。",
  )
  await assert.rejects(pipeline.approve(draftId), /同名文章|已有修改/)
  await pipeline.archive("review", draftId)
  const revision = await pipeline.revise(draftId)
  await pipeline.saveDraft("review", draftId, {
    title: revision.meta.title,
    body: revision.body + "\n\n已确认修订。",
    version: store.hash(revision.raw),
  })
  const approved = await pipeline.approve(draftId)
  assert.equal(approved.meta.publishedAt, old.meta.publishedAt)
})

test("similar content requires explicit approval", async () => {
  const old = await store.loadNote("published", draftId)
  await store.saveNote(
    "review",
    "duplicate-test",
    { title: old.meta.title, created: store.iso(), status: "review", publish: false },
    old.body,
  )
  const result = await pipeline.approve("duplicate-test")
  assert.equal(result.requiresConfirmation, true)
  await assert.rejects(store.loadNote("published", "duplicate-test"), { code: "ENOENT" })
  assert.equal(
    (await pipeline.approve("duplicate-test", { confirmDuplicate: true })).meta.publish,
    true,
  )
})

test("weekly includes only first publications in the previous complete week", async () => {
  await store.saveNote(
    "published",
    "last-week",
    {
      title: "上一周",
      summary: "上周首次发布",
      publish: true,
      publishedAt: "2026-09-09T00:00:00.000Z",
    },
    "上周知识",
  )
  await store.saveNote(
    "published",
    "older-revised",
    {
      title: "旧文修订",
      publish: true,
      publishedAt: "2026-08-01T00:00:00.000Z",
      updated: "2026-09-10T00:00:00.000Z",
    },
    "旧知识",
  )
  const digest = await pipeline.weekly(new Date("2026-09-14T02:00:00.000Z"))
  assert.equal(digest.id, "weekly-2026-09-07")
  assert.equal(digest.meta.publish, false)
  assert.ok(digest.body.includes("[[last-week|"))
  assert.ok(!digest.body.includes("older-revised"))
  assert.equal((await pipeline.weekly(new Date("2026-09-14T02:00:00.000Z"))).skipped, true)
})

test("topic stays a review draft and retains source links", async () => {
  await assert.rejects(pipeline.synthesize("单篇", ["last-week"]), /至少/)
  const topic = await pipeline.synthesize("一个专题", ["last-week", "older-revised"])
  assert.equal(topic.meta.publish, false)
  assert.ok(topic.body.includes("[[last-week|"))
  assert.ok(topic.body.includes("待补充"))
})

test("AI configuration failures do not destroy original material", async () => {
  const source = await pipeline.capture({
    title: "保留原文",
    body: "内容需要保留，用于验证 AI 接口配置错误的恢复路径。",
  })
  process.env.AI_PROVIDER = "openai"
  const originalKey = process.env.AI_API_KEY
  delete process.env.AI_API_KEY
  try {
    await assert.rejects(pipeline.organize(source.id), /配置不完整/)
    assert.equal((await store.loadNote("inbox", source.id)).body, source.body)
  } finally {
    process.env.AI_PROVIDER = "disabled"
    if (originalKey) process.env.AI_API_KEY = originalKey
  }
})

test("filesystem lock prevents competing publication writes", async () => {
  let release
  const active = store.withLock(() => new Promise((resolve) => (release = resolve)))
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5))
  try {
    await assert.rejects(
      store.withLock(async () => {}),
      /已有任务/,
    )
  } finally {
    release()
    await active
  }
  assert.equal(await store.withLock(async () => 42), 42)
})

test("failed network checks are unverified; age is flagged without rewriting articles", async () => {
  await store.saveNote(
    "published",
    "health-note",
    { title: "巡检样本", publish: true, updated: "2020-01-01" },
    "[本机链接](http://127.0.0.1/private)",
  )
  const before = (await store.loadNote("published", "health-note")).raw
  const report = await pipeline.health()
  assert.equal(report.links[0].state, "unverified")
  assert.ok(report.stale.some((n) => n.id === "health-note"))
  assert.equal((await store.loadNote("published", "health-note")).raw, before)
})
