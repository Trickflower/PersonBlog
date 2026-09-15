import fs from "node:fs/promises"
import assert from "node:assert/strict"
import path from "node:path"
import { chromium, expect } from "@playwright/test"
import sharp from "sharp"
const root = process.cwd()
const builds = (await fs.readdir(".playwright"))
  .filter((n) => /^chromium-\d+$/.test(n))
  .sort()
  .reverse()
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.platform === "win32"
      ? path.join(root, ".playwright", builds[0], "chrome-win64/chrome.exe")
      : undefined,
})
const base = process.env.BLOG_TEST_URL || "http://127.0.0.1:4311"
const errors = []
await fs.mkdir("private/qa", { recursive: true })
try {
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  const contentResponse = await page.request.get(
    `${base.replace(/\/$/, "")}/static/contentIndex.json`,
  )
  assert.equal(contentResponse.status(), 200)
  const noteCount = Object.keys(await contentResponse.json()).filter((id) => id !== "index").length
  const centered = async (node) => {
    await expect
      .poll(
        async () => {
          const frame = await page.locator(".knowledge-map").boundingBox()
          const box = await node.boundingBox()
          return Math.max(
            Math.abs(box.x + box.width / 2 - frame.x - frame.width / 2),
            Math.abs(box.y + box.height / 2 - frame.y - frame.height / 2),
          )
        },
        { message: "selected node must reach the visible graph center", timeout: 3000 },
      )
      .toBeLessThan(2)
    assert.ok(
      await node.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return el.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        )
      }),
      "central node must not be covered by preview or directory",
    )
    const zoom = await page
      .locator(".map-scene")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
    assert.ok(zoom > 1.05 && zoom < 1.2, "focus applies a modest zoom")
  }
  const overview = async () => {
    await page.locator(".map-overview").click()
    await expect
      .poll(() => page.locator(".map-scene").evaluate((el) => getComputedStyle(el).transform))
      .toBe("matrix(1, 0, 0, 1, 0, 0)")
    assert.equal(await page.locator(".map-preview:visible").count(), 0)
    const stage = await page.locator(".map-stage").boundingBox()
    for (const node of await page.locator(".map-node").all()) {
      const box = await node.boundingBox()
      assert.ok(
        box.x >= stage.x &&
          box.y >= stage.y &&
          box.x + box.width <= stage.x + stage.width &&
          box.y + box.height <= stage.y + stage.height,
        "overview contains every node",
      )
    }
  }
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1024, 768],
    [768, 900],
    [390, 844],
    [360, 640],
  ]) {
    await page.setViewportSize({ width, height })
    await page.goto(base, { waitUntil: "networkidle" })
    const nodes = page.locator(".map-node")
    assert.equal(await nodes.count(), noteCount)
    const toggle = page.locator(".map-directory-toggle")
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click()
    const full = await page.locator(".knowledge-map").boundingBox()
    assert.ok(Math.abs(full.width - width) < 2, "collapsed map fills width")
    assert.ok(full.y === 0 && Math.abs(full.height - height) < 2, "graph fills viewport vertically")
    await expect(page.locator(".map-toolbar")).toBeHidden()
    await toggle.click()
    await expect(page.locator(".map-toolbar")).toBeVisible()
    if (width > 800)
      assert.ok(
        (await page.locator(".knowledge-map").boundingBox()).width < full.width,
        "desktop directory takes space",
      )
    if (noteCount)
      assert.ok(
        await page.locator(".sidebar.left .explorer-content a").first().isVisible(),
        "directory links visible",
      )
    await toggle.click()
    const url = page.url()
    const scene = page.locator(".map-scene")
    const wallpaper = await page.evaluate(async () => {
      const url = getComputedStyle(document.body).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1]
      const image = new Image()
      image.src = url || ""
      await image.decode()
      return image.naturalWidth
    })
    assert.ok(wallpaper >= 1920, "wallpaper must load")
    const screenshot = await page.screenshot({ path: `private/qa/map-overview-${width}.png` })
    assert.ok(
      (await sharp(screenshot).stats()).channels.some((channel) => channel.stdev > 20),
      "wallpaper and graph pixels are nonblank",
    )
    if (!noteCount) {
      await expect(page.locator(".map-empty")).toBeVisible()
      await expect(page.locator(".map-overview")).toBeDisabled()
      assert.equal(await page.locator(".map-edges line").count(), 0)
      assert.equal(await page.locator(".map-preview").count(), 0)
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth > innerWidth + 1 ||
            document.documentElement.scrollHeight > innerHeight + 1,
        ),
        false,
      )
      continue
    }
    await nodes.first().click()
    assert.equal(page.url(), url, "node must not navigate")
    await centered(nodes.first())
    for (const expanded of [false, true]) {
      if (expanded) await toggle.click()
      await centered(nodes.first())
      for (const node of await nodes.all()) {
        await node.evaluate((el) => el.focus({ preventScroll: true }))
        await page.keyboard.press("Enter")
        await centered(node)
        await node.click()
        await centered(node)
      }
      // A new selection during an active animation must replace the target, not accumulate offsets.
      for (const node of [nodes.first(), nodes.nth(Math.min(1, noteCount - 1)), nodes.first()]) {
        await node.evaluate((el) => el.focus({ preventScroll: true }))
        await page.keyboard.press("Enter")
      }
      await centered(nodes.first())
      await page.screenshot({
        path: `private/qa/map-${expanded ? "expanded" : "collapsed"}-${width}.png`,
      })
    }
    await toggle.click()
    await centered(nodes.first())
    const preview = page.locator(".map-preview:visible")
    assert.ok((await preview.locator("h2").innerText()).length > 0)
    assert.ok((await preview.locator("p").innerText()).length > 30)
    await page.screenshot({ path: "private/qa/map-" + width + ".png", fullPage: true })
    await overview()
    await nodes.first().focus()
    await page.keyboard.press("Enter")
    await page.locator(".map-preview:visible .map-read").click()
    await page.waitForFunction(() => document.body.dataset.slug !== "index")
    assert.ok(await page.locator("article").isVisible())
    await page.goBack({ waitUntil: "networkidle" })
    await nodes.first().click()
    await page.keyboard.press("Escape")
    assert.equal(await page.locator(".map-preview:visible").count(), 0)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1),
      false,
    )
  }
  if (noteCount) {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.locator(".map-node").first().click()
    await centered(page.locator(".map-node").first())
    assert.equal(
      await page.locator(".map-scene").evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    )
    await overview()
  }
  assert.deepEqual(errors, [])
  console.log(
    `PASS: ${noteCount} public notes; six viewport layouts, wallpaper, directory and ${noteCount ? "focus/preview/navigation" : "empty state"}; no browser errors`,
  )
} finally {
  await browser.close()
}
