import express from "express"
import path from "node:path"
import { ROOT } from "./kb/store.mjs"
const app = express()
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }))
const port = Number(process.env.PREVIEW_PORT || 4311)
app.listen(port, "127.0.0.1", () => console.log(`Blog preview: http://127.0.0.1:${port}`))
