import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { paths } from "./store.mjs"

const exec = promisify(execFile)
export async function buildPreview() {
  const options = { cwd: paths.root, windowsHide: true, timeout: 180000, maxBuffer: 2_000_000 }
  await exec(process.execPath, [path.join(paths.root, "scripts/check-publish.mjs")], options)
  await exec(
    process.execPath,
    [path.join(paths.root, "quartz/bootstrap-cli.mjs"), "build", "-d", "vault/published"],
    options,
  )
  return { message: "博客预览已更新" }
}
