import fs from "node:fs/promises"
import path from "node:path"
import { setup, withLock, paths } from "./store.mjs"
import { capture, organize, approve, weekly, synthesize, health } from "./pipeline.mjs"
import { collect, discoverGithub } from "./collect.mjs"
import { importCloud } from "./cloud.mjs"
const [command, ...args] = process.argv.slice(2)
await setup()
const commands = {
  init: async () => ({
    message: "Knowledge folders are ready",
    vault: path.join(paths.root, "vault"),
  }),
  capture: () => capture({ url: args[0] || "" }),
  import: async () =>
    capture({
      title: args[1] || path.basename(args[0], ".md"),
      body: await fs.readFile(args[0], "utf8"),
    }),
  organize: () => organize(args[0]),
  approve: () => approve(args[0], { confirmDuplicate: args.includes("--confirm-duplicate") }),
  collect,
  github: discoverGithub,
  weekly,
  health,
  topic: () => synthesize(args[0], args.slice(1)),
  "import-cloud": importCloud,
}
if (!commands[command]) {
  console.log(
    "Usage: npm run kb -- init | capture <url> | import <file.md> [title] | organize <id> | approve <id> | collect | github | health | weekly | topic <title> <id> <id> | import-cloud",
  )
  process.exitCode = command ? 1 : 0
} else {
  try {
    console.log(JSON.stringify(await withLock(commands[command]), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
