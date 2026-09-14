import { QuartzComponent } from "./types"
import { resolveRelative, simplifySlug } from "../util/path"
// @ts-ignore
import script from "./scripts/knowledgeMap.inline"
import style from "./styles/knowledgeMap.scss"

const KnowledgeMap: QuartzComponent = ({ allFiles, fileData }) => {
  if (fileData.slug !== "index") return null
  const notes = allFiles.filter((f) => f.slug !== "index" && f.frontmatter?.publish === true)
  const nodes = notes.map((note, i) => ({
    note,
    x: 50 + (notes.length > 1 ? 31 * Math.cos((i / notes.length) * Math.PI * 2 - Math.PI / 2) : 0),
    y: 50 + (notes.length > 1 ? 30 * Math.sin((i / notes.length) * Math.PI * 2 - Math.PI / 2) : 0),
  }))
  const edges = nodes.flatMap((source, i) =>
    nodes
      .slice(i + 1)
      .filter(
        (target) =>
          source.note.links?.includes(simplifySlug(target.note.slug!)) ||
          target.note.links?.includes(simplifySlug(source.note.slug!)),
      )
      .map((target) => ({ source, target })),
  )
  return (
    <section class="knowledge-map" aria-label="知识关系图谱">
      <header class="map-toolbar">
        <button class="map-directory-toggle" aria-expanded="true" aria-controls="home-directory">
          收起目录
        </button>
        <div>
          <h1>知识关系图谱</h1>
          <p>
            {notes.length} 篇笔记 · {edges.length} 条关联 · 选择节点预览
          </p>
        </div>
      </header>
      <div class="map-stage">
        <svg class="map-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {edges.map(({ source, target }) => (
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} />
          ))}
        </svg>
        {nodes.map(({ note, x, y }, i) => (
          <button
            class="map-node"
            style={{ left: x + "%", top: y + "%" }}
            data-preview={"map-preview-" + i}
            aria-expanded="false"
            aria-controls={"map-preview-" + i}
          >
            <span class="map-dot" />
            {note.frontmatter?.title}
          </button>
        ))}
        {notes.length === 0 && <p>还没有公开笔记。</p>}
      </div>
      {notes.map((note, i) => (
        <section class="map-preview" id={"map-preview-" + i} hidden aria-label="文章预览">
          <button class="map-close" aria-label="关闭预览">
            ×
          </button>
          <h2>{note.frontmatter?.title}</h2>
          <p>
            {String(note.text ?? note.description ?? "暂无正文").slice(0, 240)}
            {String(note.text ?? "").length > 240 ? "…" : ""}
          </p>
          <a
            class="internal map-read"
            data-no-popover="true"
            href={resolveRelative(fileData.slug!, note.slug!)}
          >
            查看
          </a>
        </section>
      ))}
    </section>
  )
}
KnowledgeMap.afterDOMLoaded = script
KnowledgeMap.css = style
export default KnowledgeMap
