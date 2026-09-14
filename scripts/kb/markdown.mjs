import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import { visit } from "unist-util-visit"

const parser = unified().use(remarkParse).use(remarkGfm)
export function cleanMarkdown(markdown) {
  const tree = parser.parse(markdown)
  const changes = []
  visit(tree, (node) => {
    if (node.type === "html")
      changes.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        text: node.value.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      })
    if (
      (node.type === "link" || node.type === "image" || node.type === "definition") &&
      /^\s*(?:javascript|vbscript|data|file):/i.test(node.url)
    )
      changes.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        text: "[已移除不安全链接]",
      })
  })
  for (const change of changes.sort((a, b) => b.start - a.start))
    markdown = markdown.slice(0, change.start) + change.text + markdown.slice(change.end)
  return markdown.trim()
}

export function extractLinks(markdown) {
  const links = new Set()
  visit(parser.parse(markdown), (node) => {
    if (["link", "image", "definition"].includes(node.type) && /^https?:\/\//i.test(node.url))
      links.add(node.url)
  })
  return [...links]
}

export function tokens(text) {
  const words = text.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]+/gu) ?? []
  const out = new Map()
  for (const word of words) {
    const pieces = /\p{Script=Han}/u.test(word)
      ? Array.from({ length: Math.max(1, word.length - 1) }, (_, i) => word.slice(i, i + 2))
      : [word]
    for (const token of pieces) out.set(token, (out.get(token) ?? 0) + 1)
  }
  return out
}
export function similarity(a, b) {
  const x = tokens(a),
    y = tokens(b)
  let dot = 0,
    xx = 0,
    yy = 0
  for (const [t, n] of x) {
    dot += n * (y.get(t) ?? 0)
    xx += n * n
  }
  for (const n of y.values()) yy += n * n
  return xx && yy ? dot / Math.sqrt(xx * yy) : 0
}
export function relatedNotes(body, notes, exclude = "") {
  return notes
    .filter((n) => !n.error && n.id !== exclude && n.id !== "index")
    .map((n) => ({
      id: n.id,
      title: n.meta.title ?? n.id,
      score: Number(similarity(body, `${n.meta.title}\n${n.body}`).toFixed(3)),
    }))
    .filter((n) => n.score >= 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
