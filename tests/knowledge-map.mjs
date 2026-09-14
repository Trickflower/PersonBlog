import fs from "node:fs/promises"
import assert from "node:assert/strict"
import path from "node:path"
import { chromium } from "@playwright/test"
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
try {
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base, { waitUntil: "networkidle" })
    const nodes = page.locator(".map-node")
    assert.equal(await nodes.count(), 4)
    assert.ok((await page.locator(".map-edges line").count()) > 0)
    const toggle = page.locator(".map-directory-toggle")
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click()
    const full = await page.locator(".knowledge-map").boundingBox()
    assert.ok(Math.abs(full.width - width) < 2, "collapsed map fills width")
    await toggle.click()
    assert.ok(
      (await page.locator(".knowledge-map").boundingBox()).width < full.width,
      "expanded directory takes space",
    )
    assert.ok(
      await page.locator(".sidebar.left .explorer-content a").first().isVisible(),
      "directory links visible",
    )
    await toggle.click()
    const url = page.url()
    const scene = page.locator(".map-scene")
    await nodes.first().click()
    assert.equal(page.url(), url, "node must not navigate")
    await page.waitForTimeout(600)
    const stageBox = await page.locator(".map-stage").boundingBox()
    const focusedBox = await nodes.first().boundingBox()
    assert.ok(
      Math.abs(focusedBox.x + focusedBox.width / 2 - (stageBox.x + stageBox.width / 2)) < 3,
      "selected node moves to horizontal center",
    )
    assert.ok(
      Math.abs(focusedBox.y + focusedBox.height / 2 - (stageBox.y + stageBox.height / 2)) < 3,
      "selected node moves to vertical center",
    )
    assert.notEqual(await scene.evaluate((el) => getComputedStyle(el).transform), "none")
    const preview = page.locator(".map-preview:visible")
    assert.ok((await preview.locator("h2").innerText()).length > 0)
    assert.ok((await preview.locator("p").innerText()).length > 30)
    await page.screenshot({ path: "private/qa/map-" + width + ".png", fullPage: true })
    await preview.locator(".map-close").click()
    await page.waitForTimeout(600)
    assert.equal(await page.locator(".map-overview").isDisabled(), true)
    assert.equal(
      await scene.evaluate((el) => getComputedStyle(el).transform),
      "matrix(1, 0, 0, 1, 0, 0)",
    )
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
  }
  assert.deepEqual(errors, [])
  console.log(
    "PASS: desktop/tablet/mobile, directory, edges, preview, keyboard, article navigation, SPA return, no overflow or browser errors",
  )
} finally {
  await browser.close()
}
