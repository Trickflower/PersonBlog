import fs from "node:fs/promises"
import path from "node:path"
import { paths, parseNote } from "./kb/store.mjs"
const allowed = new Set([
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".pdf",
  ".txt",
  ".ico",
])
async function check(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name)
    if (item.name.startsWith(".") || item.isSymbolicLink())
      throw new Error(`公开目录含隐藏文件或符号链接：${full}`)
    if (item.isDirectory()) {
      await check(full)
      continue
    }
    if (!allowed.has(path.extname(item.name).toLowerCase()))
      throw new Error(`公开目录含不支持的文件：${full}`)
    if (item.name.endsWith(".md")) {
      const { meta } = parseNote(await fs.readFile(full, "utf8"))
      if (meta.publish !== true || meta.status !== "published" || !meta.approvedAt)
        throw new Error(`笔记未经审核：${full}`)
    }
  }
}
await check(paths.published)
console.log("Public boundary checked: only approved notes and public assets.")
