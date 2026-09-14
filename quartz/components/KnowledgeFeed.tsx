import { QuartzComponent, QuartzComponentProps } from "./types"
import { resolveRelative } from "../util/path"

const KnowledgeFeed: QuartzComponent = ({ allFiles, fileData }: QuartzComponentProps) => {
  if (fileData.slug !== "index") return null
  const notes = allFiles
    .filter((f) => f.slug !== "index" && f.frontmatter?.publish === true)
    .sort((a, b) =>
      String(b.frontmatter?.publishedAt ?? b.frontmatter?.created ?? "").localeCompare(
        String(a.frontmatter?.publishedAt ?? a.frontmatter?.created ?? ""),
      ),
    )
  const tags = new Set(notes.flatMap((f) => f.frontmatter?.tags ?? []))
  return (
    <section class="knowledge-feed">
      <div class="feed-heading">
        <h2>最近写下</h2>
        <span>
          {notes.length} 篇笔记 · {tags.size} 个标签
        </span>
      </div>
      {notes.slice(0, 12).map((note) => (
        <article class="feed-row" key={note.slug}>
          <div class="feed-meta">
            <span>{String(note.frontmatter?.category ?? "笔记")}</span>
            <time>
              {String(note.frontmatter?.publishedAt ?? note.frontmatter?.created ?? "").slice(
                0,
                10,
              )}
            </time>
          </div>
          <h3>
            <a class="internal" href={resolveRelative(fileData.slug!, note.slug!)}>
              {note.frontmatter?.title}
            </a>
          </h3>
          <p>{String(note.frontmatter?.summary ?? note.description ?? "")}</p>
        </article>
      ))}
    </section>
  )
}
export default KnowledgeFeed
