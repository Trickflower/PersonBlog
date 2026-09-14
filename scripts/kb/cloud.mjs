import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  config,
  paths,
  iso,
  parseNote,
  saveNote,
  listNotes,
  readJson,
  writeJson,
} from "./store.mjs"
import { cleanMarkdown } from "./markdown.mjs"

const exec = promisify(execFile)
export async function importCloud() {
  const cfg = await config()
  const repo = process.env.SITE_REPOSITORY || cfg.site.repository
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("先在设置中填写 GitHub 仓库（用户名/仓库名），并运行 gh auth login")
  const runResult = await exec(
    "gh",
    [
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      "grow.yml",
      "--status",
      "success",
      "--limit",
      "10",
      "--json",
      "databaseId,createdAt",
    ],
    { windowsHide: true, timeout: 30000 },
  )
  const runs = JSON.parse(runResult.stdout),
    stateFile = path.join(paths.state, "cloud-imports.json")
  const imported = await readJson(stateFile, [])
  const pending = runs.filter((run) => !imported.includes(run.databaseId)).reverse()
  const known = new Set(
    (await Promise.all(["inbox", "review", "archive", "published"].map(listNotes)))
      .flat()
      .flatMap((n) => [n.id, n.meta.importId, n.meta.source])
      .filter(Boolean),
  )
  let count = 0
  for (const run of pending) {
    const dest = path.join(paths.root, "private/cloud", String(run.databaseId))
    await fs.mkdir(dest, { recursive: true })
    await exec(
      "gh",
      [
        "run",
        "download",
        String(run.databaseId),
        "--repo",
        repo,
        "--name",
        "knowledge-review",
        "--dir",
        dest,
      ],
      { windowsHide: true, timeout: 120000 },
    )
    const reviewDir = path.join(dest, "vault/review")
    const files = await fs.readdir(reviewDir).catch((e) => {
      if (e.code === "ENOENT") return []
      throw e
    })
    for (const filename of files.filter((n) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,110}\.md$/.test(n))) {
      const full = path.join(reviewDir, filename)
      const stat = await fs.lstat(full)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 500000) continue
      const id = filename.slice(0, -3),
        { meta, body } = parseNote(await fs.readFile(full, "utf8"))
      if (known.has(id) || (meta.source && known.has(meta.source))) continue
      const { revisionOf, revisionHash, ...safeMeta } = meta
      await saveNote(
        "review",
        id,
        {
          ...safeMeta,
          status: "review",
          publish: false,
          importedAt: iso(),
          importId: id,
          cloudRun: run.databaseId,
        },
        cleanMarkdown(body),
      )
      known.add(id)
      if (meta.source) known.add(meta.source)
      count++
    }
    for (const name of ["collect.json", "github.json", "health.json"]) {
      const report = await readJson(path.join(dest, "private/reports", name), null)
      if (report) await writeJson(path.join(paths.reports, name), report)
    }
    imported.push(run.databaseId)
    await writeJson(stateFile, imported.slice(-100))
  }
  return { imported: count, runs: pending.length }
}
