import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { XMLParser } from "fast-xml-parser"
import { JSDOM } from "jsdom"
import { config, paths, iso, readJson, writeJson, listNotes } from "./store.mjs"
import { getJson, publicRequest } from "./network.mjs"
import { capture, organize } from "./pipeline.mjs"
import { aiStatus } from "./ai.mjs"

const exec = promisify(execFile)
export function parseTrending(html) {
  const dom = new JSDOM(html)
  try {
    return [...dom.window.document.querySelectorAll("article.Box-row")].flatMap((article) => {
      const repo = article.querySelector("h2 a")?.getAttribute("href")?.replace(/^\//, "")
      const starsText =
        [...article.querySelectorAll("a")].find((a) =>
          a.getAttribute("href")?.endsWith("/stargazers"),
        )?.textContent ?? ""
      const periodText =
        article.querySelector("span.d-inline-block.float-sm-right")?.textContent ?? ""
      const growthMatch = periodText.match(/([\d,]+)\s+stars? this month/)
      const stars = Number(starsText.replace(/[^\d]/g, ""))
      return repo && /^[\w.-]+\/[\w.-]+$/.test(repo) && stars > 0 && growthMatch
        ? [{ repo, stars, trendingMonthlyStars: Number(growthMatch[1].replace(/,/g, "")) }]
        : []
    })
  } finally {
    dom.window.close()
  }
}
export async function githubHeaders() {
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token && !process.env.CI) {
    try {
      token = (
        await exec("gh", ["auth", "token"], { windowsHide: true, timeout: 5000 })
      ).stdout.trim()
    } catch {
      /* Anonymous GitHub access remains available. */
    }
  }
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function discoverGithub() {
  const cfg = await config(),
    opts = cfg.sources.github
  if (!opts.enabled) return { items: [], skipped: true }
  const since = new Date(Date.now() - opts.days * 86400000).toISOString().slice(0, 10)
  const topicQuery = opts.topics.map((t) => `topic:${t}`).join(" ")
  const common = `stars:>${opts.minStars} archived:false fork:false ${topicQuery}`.trim()
  const headers = await githubHeaders()
  const queries = [
    { kind: "recent-created", query: `${common} created:>=${since}` },
    { kind: "recent-active", query: `${common} pushed:>=${since}` },
  ]
  const found = new Map(),
    queryResults = [],
    warnings = []
  try {
    const page = await publicRequest("https://github.com/trending?since=monthly")
    if (page.status !== 200) throw new Error(`Trending HTTP ${page.status}`)
    const trending = parseTrending(page.text)
    if (!trending.length) throw new Error("月榜页面未找到项目，可能是页面结构变化")
    const eligible = trending.filter((r) => r.stars > opts.minStars)
    queryResults.push({
      kind: "trending-monthly",
      query: "https://github.com/trending?since=monthly",
      total: eligible.length,
      incomplete: false,
    })
    for (const item of eligible.slice(0, opts.limit)) {
      try {
        const repo = await getJson(`https://api.github.com/repos/${item.repo}`, { headers })
        if (
          repo.stargazers_count <= opts.minStars ||
          repo.archived ||
          repo.fork ||
          !opts.topics.every((t) => (repo.topics ?? []).includes(t))
        )
          continue
        found.set(repo.full_name, {
          ...repo,
          discoveryKind: "trending-monthly",
          trendingMonthlyStars: item.trendingMonthlyStars,
        })
      } catch (e) {
        warnings.push({ source: item.repo, error: e.message })
      }
    }
  } catch (e) {
    warnings.push({ source: "github-trending", error: e.message })
  }
  for (const { kind, query } of queries) {
    const url = new URL("https://api.github.com/search/repositories")
    url.search = new URLSearchParams({
      q: query,
      sort: "stars",
      order: "desc",
      per_page: String(opts.limit),
    }).toString()
    try {
      const data = await getJson(url.href, { headers, maxBytes: 3_000_000 })
      queryResults.push({
        kind,
        query,
        total: data.total_count,
        incomplete: data.incomplete_results,
      })
      for (const repo of data.items ?? [])
        if (!found.has(repo.full_name)) found.set(repo.full_name, { ...repo, discoveryKind: kind })
    } catch (error) {
      warnings.push({ source: kind, error: error.message })
    }
  }
  const stateFile = path.join(paths.state, "github-stars.json")
  const history = await readJson(stateFile, {})
  const today = iso().slice(0, 10),
    now = Date.now()
  const items = [...found.values()].map((repo) => {
    const snapshots = (history[repo.full_name] ?? []).filter(
      (s) => now - new Date(s.date).getTime() < 100 * 86400000,
    )
    const baseline = snapshots
      .filter(
        (s) =>
          now - new Date(s.date).getTime() >= 30 * 86400000 &&
          now - new Date(s.date).getTime() <= 38 * 86400000,
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const monthlyGrowth = baseline ? repo.stargazers_count - baseline.stars : null
    history[repo.full_name] = [
      ...snapshots.filter((s) => s.date !== today),
      { date: today, stars: repo.stargazers_count },
    ]
    const label =
      repo.discoveryKind === "trending-monthly"
        ? `GitHub Trending 月榜，当前总星数 > ${opts.minStars}`
        : repo.discoveryKind === "recent-created"
          ? `近 ${opts.days} 天创建，当前总星数 > ${opts.minStars}`
          : `近 ${opts.days} 天有推送，当前总星数 > ${opts.minStars}；不代表月增长`
    const monthlyLine =
      repo.trendingMonthlyStars != null
        ? `\n- 月榜报告增长：${repo.trendingMonthlyStars.toLocaleString("en-US")} stars this month（[GitHub Trending](https://github.com/trending?since=monthly)，以该页面统计口径为准）`
        : ""
    const body = `# ${repo.full_name}\n\n${repo.description || "仓库未提供描述。"}\n\n## 项目信息\n\n- 仓库：[${repo.full_name}](${repo.html_url})\n- 总星数：${repo.stargazers_count.toLocaleString("en-US")}\n- 主要语言：${repo.language || "未标注"}\n- 创建时间：${repo.created_at}\n- 最近推送：${repo.pushed_at}\n- 许可证：${repo.license?.spdx_id || "未标注"}\n- 发现依据：${label}\n- 采集时间：${iso()}${monthlyLine}\n- 近 30 天星数变化：${monthlyGrowth === null ? "暂无足够历史快照" : `${monthlyGrowth}（基线 ${baseline.date}，为快照区间差值）`}\n\n## 待验证\n\n实际功能、部署成本和适用场景需要阅读项目文档或试用后补充。`
    return {
      title: repo.full_name,
      url: repo.html_url,
      body,
      kind: "github",
      metadata: {
        category: "项目观察",
        tags: ["GitHub", ...(repo.topics ?? []).slice(0, 4)],
        github: {
          repository: repo.full_name,
          stars: repo.stargazers_count,
          discoveryKind: repo.discoveryKind,
          trendingMonthlyStars: repo.trendingMonthlyStars ?? null,
          monthlyGrowth,
          baselineDate: baseline?.date ?? null,
          checkedAt: iso(),
        },
      },
    }
  })
  await writeJson(stateFile, history)
  const report = {
    at: iso(),
    queries: queryResults,
    warnings,
    items: items.map((i) => ({ title: i.title, url: i.url, ...i.metadata.github })),
  }
  await writeJson(path.join(paths.reports, "github.json"), report)
  return { ...report, items }
}

export async function discoverRss(feedUrl, limit = 4) {
  const response = await publicRequest(feedUrl)
  if (response.status !== 200) throw new Error(`RSS HTTP ${response.status}`)
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(
    response.text,
  )
  const entries = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? []
  return (Array.isArray(entries) ? entries : [entries]).slice(0, limit).flatMap((entry) => {
    const link =
      typeof entry.link === "string"
        ? entry.link
        : (Array.isArray(entry.link)
            ? entry.link.find((l) => !l["@_rel"] || l["@_rel"] === "alternate")
            : entry.link)?.["@_href"]
    const title = typeof entry.title === "string" ? entry.title : entry.title?.["#text"]
    return link
      ? [
          {
            title: title || link,
            url: link,
            kind: "rss",
            metadata: {
              feed: feedUrl,
              sourcePublishedAt: entry.pubDate || entry.published || entry.updated || null,
            },
          },
        ]
      : []
  })
}

export async function discoverSearch() {
  const {
    sources: { search },
  } = await config()
  if (search.provider === "disabled") return []
  if (!process.env.SEARCH_API_KEY) throw new Error("搜索未配置 SEARCH_API_KEY")
  const results = []
  for (const query of search.queries) {
    let entries
    if (search.provider === "brave") {
      const url = new URL("https://api.search.brave.com/res/v1/web/search")
      url.search = new URLSearchParams({
        q: query,
        count: String(search.limit),
        freshness: "pm",
      }).toString()
      entries =
        (
          await getJson(url.href, {
            headers: { "X-Subscription-Token": process.env.SEARCH_API_KEY },
          })
        ).web?.results ?? []
    } else {
      entries =
        (
          await getJson("https://api.tavily.com/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.SEARCH_API_KEY}`,
            },
            body: JSON.stringify({
              query,
              max_results: search.limit,
              time_range: "month",
              search_depth: "basic",
            }),
          })
        ).results ?? []
    }
    for (const entry of entries)
      results.push({ title: entry.title, url: entry.url, kind: "search", metadata: { query } })
  }
  return results
}

export async function collect() {
  const cfg = await config(),
    report = { at: iso(), captured: [], duplicates: [], organized: [], errors: [] },
    candidates = []
  try {
    const github = await discoverGithub()
    candidates.push(...github.items)
    report.errors.push(...(github.warnings ?? []))
  } catch (e) {
    report.errors.push({ source: "github", error: e.message })
  }
  for (const feed of cfg.sources.rss) {
    try {
      candidates.push(...(await discoverRss(feed)))
    } catch (e) {
      report.errors.push({ source: feed, error: e.message })
    }
  }
  try {
    candidates.push(...(await discoverSearch()))
  } catch (e) {
    report.errors.push({ source: "search", error: e.message })
  }
  for (const candidate of candidates) {
    if (report.captured.length >= cfg.limits.maxItemsPerRun) break
    try {
      const note = await capture(candidate)
      ;(note.duplicate ? report.duplicates : report.captured).push(note.id)
    } catch (e) {
      report.errors.push({ source: candidate.url, error: e.message })
    }
  }
  let aiCount = 0
  const existing = new Set((await listNotes("review")).map((n) => n.id))
  for (const note of (await listNotes("inbox"))
    .reverse()
    .filter((n) => !existing.has(n.id))
    .slice(0, cfg.limits.maxItemsPerRun)) {
    if (aiStatus().provider !== "disabled" && aiCount >= cfg.limits.maxAiPerRun) break
    try {
      if (aiStatus().provider !== "disabled") aiCount++
      await organize(note.id)
      report.organized.push(note.id)
    } catch (e) {
      report.errors.push({ source: note.id, error: e.message })
    }
  }
  await writeJson(path.join(paths.reports, "collect.json"), report)
  return report
}
