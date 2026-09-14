import fs from "node:fs/promises"
import path from "node:path"
import net from "node:net"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { chromium } from "@playwright/test"
import sharp from "sharp"

const root = fileURLToPath(new URL("../", import.meta.url))
const qa = path.join(root, "private/qa")
await fs.mkdir(qa, { recursive: true })
await fs.mkdir(path.join(root, "private/test-runs"), { recursive: true })
const fixture = await fs.mkdtemp(path.join(root, "private/test-runs/browser-"))
await fs.cp(path.join(root, "config"), path.join(fixture, "config"), { recursive: true })
await fs.cp(path.join(root, "vault/published"), path.join(fixture, "vault/published"), {
  recursive: true,
})
await fs.cp(path.join(root, "scripts/studio/public"), path.join(fixture, "scripts/studio/public"), {
  recursive: true,
})
await fs.symlink(
  path.join(root, "node_modules"),
  path.join(fixture, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
)
const portServer = net.createServer()
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve))
const port = portServer.address().port
await new Promise((resolve) => portServer.close(resolve))
const server = spawn(process.execPath, [path.join(root, "scripts/studio/server.mjs")], {
  cwd: root,
  env: { ...process.env, KB_ROOT: fixture, STUDIO_PORT: String(port), AI_PROVIDER: "disabled" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
})
let logs = ""
server.stdout.on("data", (b) => (logs += b))
server.stderr.on("data", (b) => (logs += b))
const base = `http://127.0.0.1:${port}`
let browser
const errors = [],
  results = {}
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${base}/api/state`)).ok) break
    } catch {}
    if (attempt === 59) throw new Error(`Server not ready: ${logs}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const browserDir = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(root, ".playwright")
  const builds = (await fs.readdir(browserDir))
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort()
    .reverse()
  const executablePath =
    process.platform === "win32" && builds.length
      ? path.join(browserDir, builds[0], "chrome-win64/chrome.exe")
      : undefined
  browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) errors.push(msg.text())
  })
  await page.goto(base)
  await page.locator("#navigation [data-view=inbox]").waitFor()
  assert.equal(
    (
      await fetch(`${base}/api/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  )
  assert.equal(
    (await fetch(`${base}/api/state`, { headers: { Origin: "https://attacker.example" } })).status,
    403,
  )
  assert.equal((await fetch(`${base}/.env`)).status, 404)
  await page.click("#new-note")
  await page.locator("#capture-form [name=title]").fill("浏览器验证：把想法整理成文章")
  await page
    .locator("#capture-form [name=body]")
    .fill(
      '## 一个独立的观察\n\n这篇隔离测试笔记用于验证编辑、人工审核以及代码保留。\n\n```js\nconsole.log("hello knowledge")\n```\n\n[[connected-notes|连接知识]]',
    )
  await page.locator("#capture-form button[type=submit]").click()
  await page.locator("#edit-title").waitFor()
  await page.locator("[data-editor-tab=preview]").click()
  assert.ok(
    await page
      .locator("#markdown-preview")
      .innerText()
      .then((text) => text.includes("hello knowledge")),
  )
  await page.locator("[data-editor-tab=source]").click()
  await page.locator("[data-command=organize]").click()
  await page.waitForFunction(() => document.querySelector("#page-title")?.textContent === "待审核")
  await page.locator("#edit-title").fill("人工审核后的文章")
  await page.locator("[data-command=save]").click()
  await page.waitForFunction(() => document.querySelector("#save-status")?.textContent === "已保存")
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: path.join(qa, "review-desktop.png"), fullPage: true })
  await page.locator("[data-command=approve]").click()
  await page.waitForFunction(() => document.querySelector("#page-title")?.textContent === "已发布")
  assert.equal(await page.locator("#edit-title").inputValue(), "人工审核后的文章")
  const apiState = await (await fetch(`${base}/api/state`)).json()
  assert.equal(apiState.notes.review.length, 0)
  assert.equal(apiState.notes.inbox.length, 0)
  assert.equal(apiState.notes.published.length, 5)
  results.workflow = "capture, edit, preview, organize, approve verified"
  await page.locator("[data-command=close]").click()
  const checkboxes = page.locator("[data-check]")
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
  await page.click("#make-topic")
  await page.fill("#topic-title", "测试专题")
  await page.click("#confirm-ok")
  await page.waitForFunction(() =>
    document.querySelector("#job-banner")?.textContent.includes("已完成"),
  )
  await page.locator("#navigation [data-view=review]").click()
  await page.locator("[data-note]").first().click()
  await page.locator("#edit-title").waitFor()
  assert.equal(await page.locator("#edit-title").inputValue(), "测试专题")
  await page.locator("[data-command=archive]").click()
  await page.click("#confirm-ok")
  await page.waitForFunction(() => !document.querySelector("#edit-title"))
  await page.locator("#navigation [data-view=archive]").click()
  await page.locator("[data-note]").filter({ hasText: "测试专题" }).first().click()
  await page.locator("[data-command=restore]").click()
  await page.waitForFunction(() => document.querySelector("#page-title")?.textContent === "收件箱")
  results.archive = "archive and restore verified"
  await page.locator("#navigation [data-view=settings]").click()
  await page.locator("#settings-form [name=title]").fill("隔离测试站点")
  await page.locator("#settings-form button[type=submit]").click()
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "设置已保存")
  assert.equal((await (await fetch(`${base}/api/state`)).json()).config.site.title, "隔离测试站点")
  results.settings = "saved and reloaded"
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const view of ["inbox", "review", "published", "archive", "tasks", "health", "settings"]) {
      await page.locator(`#navigation [data-view=${view}]`).click()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
      assert.equal(overflow, false, `${view} overflow at ${width}`)
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator("#navigation [data-view=inbox]").click()
  await page.locator("[data-note]").first().click()
  await page.screenshot({ path: path.join(qa, "review-mobile.png"), fullPage: true })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  )
  results.responsive = "7 views at 390, 768 and 1440 pixels"
  const blog = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  blog.on("pageerror", (error) => errors.push(`blog: ${error.message}`))
  await blog.goto("http://127.0.0.1:4311", { waitUntil: "networkidle" })
  await blog.locator(".knowledge-map").waitFor()
  const imageOk = await blog
    .locator("article img")
    .evaluateAll((imgs) => imgs.every((img) => img.complete && img.naturalWidth > 0))
  assert.equal(imageOk, true, "blog cover must load")
  assert.equal(await blog.locator(".map-node").count(), 4)
  await blog.screenshot({ path: path.join(qa, "blog-desktop.png"), fullPage: true })
  await blog.goto("http://127.0.0.1:4311/markdown-notes", { waitUntil: "networkidle" })
  assert.ok((await blog.locator("article pre").innerText()).includes("unique_tags"))
  assert.ok((await blog.locator('a.internal[href*="connected-notes"]').count()) > 0)
  await blog.locator(".search-button").first().click()
  await blog.locator(".search-bar").first().fill("代码")
  await blog.waitForTimeout(500)
  assert.ok((await blog.locator(".result-card").count()) > 0, "Chinese search must find articles")
  await blog.keyboard.press("Escape")
  await blog.goto("http://127.0.0.1:4311", { waitUntil: "networkidle" })
  await blog.goto("http://127.0.0.1:4311/markdown-notes", { waitUntil: "networkidle" })
  await blog.locator(".global-graph-icon").click()
  await blog.waitForTimeout(1200)
  const canvas = blog.locator(".global-graph-container canvas")
  await canvas.waitFor({ state: "visible" })
  assert.ok(await canvas.evaluate((c) => c.width > 0 && c.height > 0))
  const graphPixels = await sharp(await canvas.screenshot()).stats()
  assert.ok(
    graphPixels.channels.some((channel) => channel.stdev > 2),
    "graph pixels must be nonblank",
  )
  const graphBox = await canvas.boundingBox()
  await blog.mouse.move(graphBox.x + graphBox.width / 2, graphBox.y + graphBox.height / 2)
  await blog.mouse.wheel(0, -150)
  await blog.waitForTimeout(300)
  await blog.screenshot({ path: path.join(qa, "knowledge-graph.png"), fullPage: true })
  results.graph = "visible canvas, nonblank pixels and zoom interaction checked"
  await blog.keyboard.press("Escape")
  await blog.setViewportSize({ width: 390, height: 844 })
  await blog.goto("http://127.0.0.1:4311", { waitUntil: "networkidle" })
  assert.equal(
    await blog.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  )
  await blog.screenshot({ path: path.join(qa, "blog-mobile.png"), fullPage: true })
  const publicIndex = await (await fetch("http://127.0.0.1:4311/static/contentIndex.json")).json()
  assert.ok(!Object.keys(publicIndex).some((id) => id.startsWith("source-") || id === "first-idea"))
  assert.equal((await fetch("http://127.0.0.1:4311/api/state")).status, 404)
  results.blog =
    "cover, articles, code, wikilinks, Chinese search, mobile layout, private boundary verified"
  assert.deepEqual(errors, [], `Browser errors: ${errors.join("\n")}`)
  await fs.writeFile(
    path.join(qa, "browser-results.json"),
    JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2),
  )
  console.log(JSON.stringify(results, null, 2))
} finally {
  if (browser) await browser.close()
  const stopped = new Promise((resolve) => server.once("exit", resolve))
  server.kill()
  await stopped
  await fs.writeFile(path.join(qa, "browser-server.log"), logs)
}
