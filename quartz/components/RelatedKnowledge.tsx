import { QuartzComponent, QuartzComponentProps } from "./types"
import { resolveRelative } from "../util/path"

const RelatedKnowledge: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
  if (fileData.slug === "index") return null
  const tags = new Set(fileData.frontmatter?.tags ?? [])
  const links = new Set<string>(fileData.links ?? [])
  const notes = allFiles
    .filter(
      (f) => f.slug !== fileData.slug && f.slug !== "index" && f.frontmatter?.publish === true,
    )
    .map((f) => ({
      note: f,
      score:
        (f.frontmatter?.tags ?? []).filter((tag) => tags.has(tag)).length +
        (links.has(f.slug!) ? 2 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
  if (!notes.length) return null
  return (
    <section class="related-knowledge">
      <h3>相关内容</h3>
      <ul>
        {notes.map(({ note }) => (
          <li key={note.slug}>
            <a class="internal" href={resolveRelative(fileData.slug!, note.slug!)}>
              {note.frontmatter?.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
export default RelatedKnowledge
