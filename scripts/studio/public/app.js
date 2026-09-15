import { marked } from "/vendor/marked.js"

const $ = (selector) => document.querySelector(selector)
const escape = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  )
const icon = (name) => `<i data-lucide="${name === "github" ? "git-fork" : name}"></i>`
const noteUrl = (id) => `http://127.0.0.1:4311/${encodeURIComponent(id.replace(/\s/g, "-"))}`
const icons = () => {
  window.lucide?.createIcons()
  document.querySelectorAll('a[href^="http://127.0.0.1:4311/"]').forEach((link) => {
    link.href = link.href.replace(/%20/g, "-")
  })
}
let state,
  view = "inbox",
  selected = null,
  note = null,
  dirty = false,
  mode = "manual",
  query = "",
  chosen = new Set(),
  toastTimer,
  polling = false
const views = {
  inbox: ["收件箱", "inbox"],
  review: ["待审核", "scan-text"],
  published: ["已发布", "book-open"],
  archive: ["归档", "archive"],
  tasks: ["采集任务", "radar"],
  health: ["知识巡检", "activity"],
  settings: ["设置", "settings-2"],
}

async function api(url, body) {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-KB-Token": state.token },
          body: JSON.stringify(body),
        },
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}
function toast(message) {
  clearTimeout(toastTimer)
  $("#toast").textContent = message
  $("#toast").hidden = false
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5500)
}
async function guarded(work, button) {
  if (button) button.disabled = true
  try {
    await work()
  } catch (error) {
    toast(error.message)
  } finally {
    if (button) button.disabled = false
    icons()
  }
}
function confirmAction(title, message, { topic = false } = {}) {
  return new Promise((resolve) => {
    const dialog = $("#confirm-dialog")
    $("#confirm-title").textContent = title
    $("#confirm-message").textContent = message
    $("#topic-field").hidden = !topic
    $("#topic-title").value = ""
    const done = (value) => {
      dialog.close()
      dialog.oncancel = null
      resolve(value)
    }
    $("#confirm-cancel").onclick = () => done(false)
    $("#confirm-ok").onclick = () => {
      if (topic && !$("#topic-title").value.trim()) {
        $("#topic-title").focus()
        return
      }
      done(topic ? $("#topic-title").value.trim() : true)
    }
    dialog.oncancel = (event) => {
      event.preventDefault()
      done(false)
    }
    dialog.showModal()
    if (topic) $("#topic-title").focus()
  })
}
async function leave() {
  return !dirty || (await confirmAction("离开当前笔记？", "尚有未保存的修改。"))
}
function nav() {
  $("#navigation").innerHTML = Object.entries(views)
    .map(
      ([key, [label, name]], i) =>
        `${i === 4 ? '<div class="nav-divider"></div>' : ""}<button data-view="${key}" class="${view === key ? "active" : ""}">${icon(name)}${label}${state.notes[key] ? `<span class="count">${state.notes[key].length}</span>` : ""}</button>`,
    )
    .join("")
  $("#page-title").textContent = views[view][0]
  $("#ai-status").textContent = state.ai.enabled
    ? `AI · ${state.ai.model}`
    : state.ai.provider === "disabled"
      ? "规则整理 · 已就绪"
      : "AI · 配置未完成"
  $("#metrics").innerHTML = [
    ["待整理", state.notes.inbox.length, "inbox"],
    ["待审核", state.notes.review.length, "scan-text"],
    ["已发布", state.notes.published.length, "book-open"],
    ["知识标签", new Set(state.notes.published.flatMap((n) => n.meta.tags || [])).size, "hash"],
  ]
    .map(
      ([label, value, name]) =>
        `<div class="metric"><div class="metric-label">${icon(name)}${label}</div><div class="metric-value">${value.toString().padStart(2, "0")}</div></div>`,
    )
    .join("")
  jobBanner()
  icons()
}
function jobBanner() {
  const el = $("#job-banner"),
    job = state.job
  el.hidden = !job
  if (!job) return
  const names = {
    collect: "内容采集",
    health: "知识巡检",
    weekly: "周记生成",
    topic: "专题整理",
    "import-cloud": "云端草稿同步",
    build: "更新博客预览",
  }
  el.className = job.status === "error" ? "error" : ""
  const result = job.result
  el.textContent = `${names[job.task]} · ${job.status === "running" ? "运行中" : job.status === "error" ? job.error : result?.errors?.length ? `完成，${result.errors.length} 项未成功` : result?.message || "已完成"}${result?.captured ? ` · 新收录 ${result.captured.length} · 整理 ${result.organized.length} · 重复 ${result.duplicates.length}` : ""}${result?.imported !== undefined ? ` · 导入 ${result.imported} 篇` : ""}`
}
async function refresh(render = true) {
  state = await api("/api/state")
  nav()
  if (render) renderView()
}
function renderView() {
  if (state.notes[view]) renderNotes()
  else if (view === "tasks") renderTasks()
  else if (view === "health") renderHealth()
  else renderSettings()
  icons()
}
function empty(title, name = "file-text") {
  return `<div class="empty">${icon(name)}<h3>${escape(title)}</h3></div>`
}
function renderNotes() {
  $("#content").innerHTML =
    `<div class="list-toolbar"><div class="left"><span class="section-title">${view === "inbox" ? "等待整理" : view === "review" ? "审核队列" : view === "published" ? "知识目录" : "已归档内容"}</span><span class="quiet" id="list-count"></span>${view === "published" ? `<button id="make-topic" class="secondary">${icon("layers")}生成专题</button>` : ""}</div><label class="searchbox">${icon("search")}<input id="filter" aria-label="筛选笔记" placeholder="搜索标题、摘要、标签" value="${escape(query)}"></label></div><div class="notes-layout ${selected ? "has-editor" : ""}"><div class="note-list" id="note-list"></div><div id="editor-container" ${selected ? "" : "hidden"}></div></div>`
  renderList()
  $("#filter").addEventListener("input", (event) => {
    query = event.target.value
    renderList()
  })
  if (selected && note) renderEditor()
  $("#make-topic")?.addEventListener("click", (event) =>
    guarded(async () => {
      if (chosen.size < 2) return toast("请选择至少两篇笔记")
      const title = await confirmAction("生成专题", `已选择 ${chosen.size} 篇笔记。`, {
        topic: true,
      })
      if (title) await startJob("topic", { title, ids: [...chosen] })
    }, event.currentTarget),
  )
}
function renderList() {
  const items = state.notes[view].filter((n) =>
    `${n.meta.title} ${n.meta.summary ?? ""} ${(n.meta.tags ?? []).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  $("#list-count").textContent = `${items.length} 篇`
  $("#note-list").innerHTML = items.length
    ? items
        .map(
          (n) =>
            `<div role="button" tabindex="0" class="note-row ${selected === n.id ? "selected" : ""}" data-note="${escape(n.id)}">${view === "published" ? `<input type="checkbox" aria-label="选择 ${escape(n.meta.title)}" data-check="${escape(n.id)}" ${chosen.has(n.id) ? "checked" : ""}>` : ""}<div class="note-icon ${n.meta.kind === "github" ? "github" : ""}">${icon(n.meta.kind === "github" ? "github" : n.meta.kind === "wechat" ? "message-circle" : n.meta.kind === "weekly" ? "calendar-days" : "file-text")}</div><div class="note-info"><h3>${escape(n.meta.title || n.id)}</h3><p>${escape(n.error || n.meta.summary || n.meta.source || "未添加摘要")}</p><div class="row-meta">${n.meta.category ? `<span>${escape(n.meta.category)}</span>` : ""}${(
              n.meta.tags || []
            )
              .slice(0, 3)
              .map((t) => `<span class="tag">${escape(t)}</span>`)
              .join(
                "",
              )}${n.meta.similar?.length ? '<span class="tag amber">内容相似</span>' : ""}${n.meta.organizer === "ai" ? '<span class="tag green">AI 整理</span>' : ""}<time class="row-date">${escape(String(n.meta.updated || n.meta.created || "").slice(0, 10))}</time></div></div></div>`,
        )
        .join("")
    : empty(
        query
          ? "没有匹配的笔记"
          : view === "inbox"
            ? "收件箱已清空"
            : view === "review"
              ? "暂无待审核内容"
              : view === "archive"
                ? "暂无归档内容"
                : "暂无已发布笔记",
        views[view][1],
      )
  icons()
}
async function selectNote(id) {
  if (!(await leave())) return
  dirty = false
  selected = id
  note = await api(`/api/notes/${view}/${id}`)
  renderNotes()
  icons()
  if (window.innerWidth < 1100)
    $("#editor-container").scrollIntoView({ behavior: "smooth", block: "start" })
}
function preview(body) {
  const wiki = body.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m, id, title) => `[${title || id}](${noteUrl(id)})`,
  )
  return window.DOMPurify.sanitize(marked.parse(wiki), {
    FORBID_TAGS: ["form", "input", "button", "iframe", "style"],
    FORBID_ATTR: ["style"],
  })
}
function renderEditor() {
  const editable = ["inbox", "review"].includes(view)
  $("#editor-container").innerHTML =
    `<section class="editor"><div class="editor-heading"><h3>${view === "review" ? "审核笔记" : view === "published" ? "已发布文章" : view === "archive" ? "归档记录" : "原始笔记"}</h3><button class="icon" data-command="close" title="关闭笔记" aria-label="关闭笔记">${icon("x")}</button></div>${note.meta.source ? `<div class="source-link"><a href="${escape(/^https?:\/\//.test(note.meta.source) ? note.meta.source : "#")}" target="_blank" rel="noopener noreferrer">${escape(note.meta.source)}</a></div>` : ""}<div class="editor-fields"><label>标题<input id="edit-title" class="editor-title" maxlength="160" value="${escape(note.meta.title)}" ${editable ? "" : "readonly"}></label><div class="field-grid"><label>分类<select id="edit-category" ${editable ? "" : "disabled"}>${state.config.categories.map((c) => `<option ${c === note.meta.category ? "selected" : ""}>${escape(c)}</option>`).join("")}</select></label><label>标签<input id="edit-tags" value="${escape((note.meta.tags || []).join(", "))}" ${editable ? "" : "readonly"}></label></div><label>摘要<textarea id="edit-summary" rows="2" maxlength="1200" ${editable ? "" : "readonly"}>${escape(note.meta.summary || "")}</textarea></label></div><div class="editor-tabs"><div class="segmented"><button data-editor-tab="source" class="${editable ? "active" : ""}">Markdown</button><button data-editor-tab="preview" class="${editable ? "" : "active"}">预览</button></div><span class="quiet" id="save-status">${note.meta.organizer === "ai" ? "AI 草稿" : note.meta.organizer === "rules" ? "规则整理" : "手动笔记"}</span></div><textarea id="edit-body" class="markdown" aria-label="Markdown 正文" ${editable ? "" : "readonly hidden"}>${escape(note.body)}</textarea><div class="prose" id="markdown-preview" ${editable ? "hidden" : ""}>${preview(note.body)}</div>${note.meta.inputTruncated ? '<div class="source-link">AI 仅整理了原文的一部分，完整资料保留在收件箱。</div>' : ""}<div class="editor-footer">${editable ? `<button class="secondary" data-command="save">${icon("save")}保存</button><button class="icon danger" data-command="archive" title="归档" aria-label="归档">${icon("archive")}</button><span class="spacer"></span>${view === "inbox" ? `<button class="primary" data-command="organize">${icon("sparkles")}整理</button>` : `<button class="primary" data-command="approve">${icon("check")}批准发布</button>`}` : view === "published" ? `<button class="secondary" data-command="revise">${icon("pencil")}创建修订稿</button><a href="http://127.0.0.1:4311/${encodeURIComponent(note.id)}" target="_blank" rel="noopener">查看文章</a>` : `<button class="secondary" data-command="restore">${icon("archive-restore")}恢复到收件箱</button>`}</div><div class="recommendations"><h4>相关内容</h4>${note.recommendations.length ? note.recommendations.map((r) => `<p><a href="http://127.0.0.1:4311/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">${escape(r.title)}</a><span class="score">${Math.round(r.score * 100)}%</span></p>`).join("") : "<p>暂无相近笔记</p>"}</div></section>`
  if (view === "published") {
    $(".editor-footer").insertAdjacentHTML(
      "beforeend",
      `<button class="icon danger" data-command="delete" title="删除文章" aria-label="删除文章">${icon("trash-2")}</button>`,
    )
  }
  $("#editor-container").addEventListener("input", () => {
    dirty = true
    $("#save-status").textContent = "未保存"
  })
  icons()
}
async function saveCurrent() {
  await api(`/api/notes/${view}/${selected}`, {
    title: $("#edit-title").value,
    body: $("#edit-body").value,
    summary: $("#edit-summary").value,
    category: $("#edit-category").value,
    tags: $("#edit-tags")
      .value.split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean),
    version: note.version,
  })
  dirty = false
  note = await api(`/api/notes/${view}/${selected}`)
  $("#save-status").textContent = "已保存"
  await refresh(false)
  renderList()
}
async function command(action) {
  if (action === "close") {
    if (!(await leave())) return
    selected = null
    note = null
    dirty = false
    renderNotes()
    return
  }
  if (action === "save") {
    await saveCurrent()
    toast("笔记已保存")
    return
  }
  if (action === "archive" && !(await confirmAction("归档这篇笔记？", "归档后仍可恢复到收件箱。")))
    return
  if (
    action === "delete" &&
    !(await confirmAction(
      `删除「${note.meta.title}」？`,
      "文章将移出已发布目录，并保留本地备份。重新构建并发布后，线上文章会下架。",
    ))
  )
    return
  if (dirty && ["organize", "approve", "archive"].includes(action)) await saveCurrent()
  let result = await api("/api/action", { action, id: selected, area: view, version: note.version })
  if (result?.requiresConfirmation) {
    const ok = await confirmAction(
      "发现相似内容",
      result.similar.map((r) => `${r.title} · ${Math.round(r.score * 100)}%`).join("\n") +
        "\n仍然批准发布？",
    )
    if (!ok) return
    result = await api("/api/action", {
      action,
      id: selected,
      confirmDuplicate: true,
      version: note.version,
    })
  }
  if (action === "delete") chosen.delete(selected)
  dirty = false
  note = null
  selected = null
  view =
    { organize: "review", approve: "published", restore: "inbox", revise: "review" }[action] || view
  await refresh()
  if (result?.id) await selectNote(result.id)
  toast(
    {
      organize: "已加入审核队列",
      approve: "已批准，发布文件已写入",
      archive: "已归档",
      restore: "已恢复",
      revise: "修订稿已创建",
      delete: "文章已删除；更新博客预览并发布后，线上下架",
    }[action],
  )
}
function renderTasks() {
  const collect = state.reports.collect,
    github = state.reports.github
  $("#content").innerHTML =
    `<div class="list-toolbar"><span class="section-title">任务中心</span><span class="quiet">${state.job?.status === "running" ? "有任务运行中" : "空闲"}</span></div><div class="task-list">${[
      [
        "collect",
        "radar",
        "发现与整理",
        `${state.config.sources.rss.length} 个 RSS 来源 · GitHub 项目发现 · ${state.config.sources.search.provider === "disabled" ? "搜索未启用" : state.config.sources.search.provider}`,
      ],
      [
        "import-cloud",
        "cloud-download",
        "同步云端草稿",
        state.config.site.repository || "尚未关联 GitHub 仓库",
      ],
      ["weekly", "calendar-days", "本周新增知识", "汇集上一完整周首次发布的笔记"],
      ["health", "activity", "链接与知识巡检", `复核阈值 ${state.config.limits.staleDays} 天`],
      ["build", "refresh-cw", "更新博客预览", `${state.notes.published.length} 篇已发布文章`],
    ]
      .map(
        ([task, name, title, desc]) =>
          `<div class="task-row">${icon(name)}<div><h3>${title}</h3><p>${escape(desc)}</p></div><button data-job="${task}">${icon("play")}运行</button></div>`,
      )
      .join(
        "",
      )}</div>${collect ? `<h3 class="report-heading">最近采集 <span class="quiet">${escape(collect.at?.slice(0, 16))}</span></h3><p class="quiet">新收录 ${collect.captured.length} · 已整理 ${collect.organized.length} · 重复 ${collect.duplicates.length}</p>${collect.errors.length ? `<table class="report-table"><thead><tr><th>来源</th><th>结果</th></tr></thead><tbody>${collect.errors.map((e) => `<tr><td>${escape(e.source)}</td><td>${escape(e.error)}</td></tr>`).join("")}</tbody></table>` : ""}` : ""}${github ? githubReport(github) : ""}`
}
function githubReport(report) {
  const labels = {
    "trending-monthly": "Trending 月榜",
    "recent-created": "近期创建",
    "recent-active": "近期有推送",
  }
  return `<h3 class="report-heading">GitHub 项目观察</h3>
    ${report.queries.map((q) => `<p class="quiet">${labels[q.kind] || escape(q.kind)}：${q.total} 个匹配${q.incomplete ? "（结果不完整）" : ""}</p>`).join("")}
    <table class="report-table"><thead><tr><th>项目</th><th>总 Stars</th><th>发现依据</th><th>月榜报告增长</th><th>30 天快照差值</th></tr></thead>
    <tbody>${report.items.map((r) => `<tr><td><a href="${escape(r.url)}" target="_blank" rel="noopener">${escape(r.title)}</a></td><td>${r.stars.toLocaleString()}</td><td>${labels[r.discoveryKind] || escape(r.discoveryKind)}</td><td>${r.trendingMonthlyStars == null ? "未提供" : r.trendingMonthlyStars.toLocaleString()}</td><td>${r.monthlyGrowth == null ? "历史不足" : r.monthlyGrowth.toLocaleString()}</td></tr>`).join("")}</tbody></table>`
}
function renderHealth() {
  const report = state.reports.health
  $("#content").innerHTML =
    `<div class="list-toolbar"><span class="section-title">知识巡检</span><button data-job="health">${icon("refresh-cw")}开始巡检</button></div>${report ? `<p class="quiet">上次巡检 ${escape(report.at.slice(0, 16))} · 已检查 ${report.checked} 个链接 · 本次未检查 ${report.remaining} 个</p><div class="health-stats"><div><strong>${report.links.filter((l) => l.state === "broken").length}</strong><span>确认失效</span></div><div><strong>${report.links.filter((l) => l.state === "unverified").length}</strong><span>需要人工确认</span></div><div><strong>${report.stale.length}</strong><span>到期复核</span></div><div><strong>${report.duplicates.length}</strong><span>相似文章对</span></div></div><h3>链接状态</h3><table class="report-table"><thead><tr><th>链接</th><th>状态</th></tr></thead><tbody>${report.links.map((l) => `<tr><td><a href="${escape(l.url)}" target="_blank" rel="noopener">${escape(l.url)}</a></td><td>${l.state === "ok" ? "正常" : l.state === "broken" ? "失效" : "待确认"} · ${escape(l.status || l.error)}</td></tr>`).join("")}</tbody></table><h3 class="report-heading">到期复核</h3>${report.stale.length ? report.stale.map((n) => `<p class="quiet">${escape(n.title)} · ${escape(String(n.lastVerified).slice(0, 10))}</p>`).join("") : empty("暂无到期笔记", "check-check")}<h3 class="report-heading">相似内容</h3>${report.duplicates.length ? report.duplicates.map((d) => `<p class="quiet">${escape(d.a)} / ${escape(d.b)} · ${Math.round(d.score * 100)}%</p>`).join("") : empty("未发现高相似文章", "files")}` : empty("尚未巡检", "activity")}`
}
function renderSettings() {
  const cfg = state.config
  const field = (label, name, value, type = "text") =>
    `<label>${label}<input type="${type}" name="${name}" value="${escape(value)}"></label>`
  $("#content").innerHTML =
    `<form id="settings-form" class="settings"><div class="list-toolbar"><span class="section-title">知识库设置</span><button class="primary" type="submit">${icon("save")}保存设置</button></div><section class="settings-section"><h3>网站</h3><div class="field-grid">${field("名称", "title", cfg.site.title)}${field("作者", "author", cfg.site.author)}</div>${field("简介", "description", cfg.site.description)}<div class="field-grid">${field("域名 / Pages 地址（不含 https://）", "baseUrl", cfg.site.baseUrl)}${field("GitHub 仓库（用户名/仓库名）", "repository", cfg.site.repository)}</div>${field("分类（逗号分隔）", "categories", cfg.categories.join(", "))}</section><section class="settings-section"><h3>GitHub 项目发现</h3><label class="checkbox-label"><input type="checkbox" name="githubEnabled" ${cfg.sources.github.enabled ? "checked" : ""}>启用</label><div class="field-grid">${field("时间窗口（天）", "days", cfg.sources.github.days, "number")}${field("总星数大于", "minStars", cfg.sources.github.minStars, "number")}</div>${field("Topics（逗号分隔，全部匹配）", "topics", cfg.sources.github.topics.join(", "))}</section><section class="settings-section"><h3>RSS 与联网搜索</h3><label>RSS 地址（每行一个）<textarea name="rss">${escape(cfg.sources.rss.join("\n"))}</textarea></label><label>搜索服务<select name="provider">${[
      ["disabled", "关闭"],
      ["brave", "Brave Search"],
      ["tavily", "Tavily"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${cfg.sources.search.provider === v ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label>搜索关键词（每行一个）<textarea name="queries">${escape(cfg.sources.search.queries.join("\n"))}</textarea></label></section><section class="settings-section"><h3>整理与巡检</h3><div class="field-grid">${field("每次采集上限", "maxItemsPerRun", cfg.limits.maxItemsPerRun, "number")}${field("每次 AI 调用上限", "maxAiPerRun", cfg.limits.maxAiPerRun, "number")}${field("到期复核天数", "staleDays", cfg.limits.staleDays, "number")}${field("每次链接检查上限", "maxLinksPerRun", cfg.limits.maxLinksPerRun, "number")}</div><p class="quiet">AI 状态：${state.ai.enabled ? escape(state.ai.model) : state.ai.provider === "disabled" ? "未启用" : "配置未完成"}</p></section></form>`
  $("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault()
    guarded(async () => {
      const f = new FormData(event.currentTarget),
        next = structuredClone(cfg),
        split = (name, separator) =>
          String(f.get(name))
            .split(separator)
            .map((s) => s.trim())
            .filter(Boolean)
      for (const name of ["title", "author", "description", "baseUrl", "repository"])
        next.site[name] = String(f.get(name)).trim()
      next.categories = split("categories", /[,，]/)
      next.sources.rss = split("rss", /\n/)
      next.sources.search.provider = String(f.get("provider"))
      next.sources.search.queries = split("queries", /\n/)
      next.sources.github.enabled = f.has("githubEnabled")
      next.sources.github.days = Number(f.get("days"))
      next.sources.github.minStars = Number(f.get("minStars"))
      next.sources.github.topics = split("topics", /[,，]/)
      for (const key of ["maxItemsPerRun", "maxAiPerRun", "staleDays", "maxLinksPerRun"])
        next.limits[key] = Number(f.get(key))
      await api("/api/config", next)
      await refresh()
      toast("设置已保存")
    }, event.submitter)
  })
}
async function startJob(task, values = {}) {
  await api("/api/jobs", { task, ...values })
  await refresh(false)
  toast("任务已启动")
}

$("#navigation").addEventListener("click", (event) =>
  guarded(async () => {
    const button = event.target.closest("[data-view]")
    if (!button || !(await leave())) return
    view = button.dataset.view
    selected = null
    note = null
    dirty = false
    query = ""
    chosen.clear()
    nav()
    renderView()
  }),
)
$("#content").addEventListener("click", (event) =>
  guarded(async () => {
    const checkbox = event.target.closest("[data-check]")
    if (checkbox) {
      checkbox.checked ? chosen.add(checkbox.dataset.check) : chosen.delete(checkbox.dataset.check)
      return
    }
    const row = event.target.closest("[data-note]")
    if (row) {
      await selectNote(row.dataset.note)
      return
    }
    const action = event.target.closest("[data-command]")
    if (action) {
      await guarded(() => command(action.dataset.command), action)
      return
    }
    const tab = event.target.closest("[data-editor-tab]")
    if (tab) {
      const isPreview = tab.dataset.editorTab === "preview"
      $("#edit-body").hidden = isPreview
      $("#markdown-preview").hidden = !isPreview
      if (isPreview) $("#markdown-preview").innerHTML = preview($("#edit-body").value)
      document
        .querySelectorAll("[data-editor-tab]")
        .forEach((b) => b.classList.toggle("active", b === tab))
      return
    }
    const job = event.target.closest("[data-job]")
    if (job) await startJob(job.dataset.job)
  }),
)
$("#content").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("[data-note]")) event.target.click()
})
$("#collect").addEventListener("click", (event) =>
  guarded(() => startJob("collect"), event.currentTarget),
)
$("#new-note").addEventListener("click", () => {
  $("#capture-form").reset()
  setMode("manual")
  $("#capture-dialog").showModal()
})
function setMode(value) {
  mode = value
  $("#url-field").hidden = mode === "manual"
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === value))
}
$("#capture-modes").addEventListener("click", (event) => {
  const b = event.target.closest("[data-mode]")
  if (b) setMode(b.dataset.mode)
})
document
  .querySelectorAll(".close-dialog")
  .forEach((button) => button.addEventListener("click", () => $("#capture-dialog").close()))
$("#capture-form").addEventListener("submit", (event) => {
  event.preventDefault()
  guarded(async () => {
    if (!(await leave())) return
    const values = Object.fromEntries(new FormData(event.currentTarget)),
      result = await api("/api/capture", { ...values, kind: mode })
    $("#capture-dialog").close()
    dirty = false
    selected = null
    note = null
    query = ""
    view = result.area
    await refresh()
    await selectNote(result.id)
    toast(result.duplicate ? "已存在相同来源或内容" : "已收录到收件箱")
  }, event.submitter)
})
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault()
    event.returnValue = ""
  }
})
await guarded(() => refresh())
setInterval(async () => {
  if (polling || !state) return
  polling = true
  try {
    const old = state.job?.status
    await refresh(false)
    if (old === "running" && state.job?.status !== "running") {
      if (!dirty) renderView()
      toast(state.job.status === "error" ? state.job.error : "任务完成")
    }
  } catch {
  } finally {
    polling = false
  }
}, 2500)
