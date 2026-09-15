# 拾知 · PersonBlog

基于 Obsidian + Quartz 4.5.2 + GitHub + AI 整理脚本的个人知识库。所有代码、笔记、运行文件和测试产物都位于 `D:\PersonBlog`。

## 启动

需要 Node.js 22.16 或更新版本（推荐 Node.js 24）与 Git。

```powershell
cd D:\PersonBlog
npm ci
npm run dev
```

工作台默认地址：<http://127.0.0.1:4312>。另开一个终端运行：

```powershell
cd D:\PersonBlog
npm run build
npm run preview
```

博客预览：<http://127.0.0.1:4311>。`npm run build` 生成 `public`，预览服务显示最新构建。批准发布后，在工作台“采集任务”中运行“更新博客预览”即可看到新文章；推送 GitHub 时会自动构建。

也可以在 PowerShell 中运行 `./Start-PersonBlog.ps1`，构建并在后台启动两个服务；运行 `./Stop-PersonBlog.ps1` 停止由启动脚本创建的服务。

## 日常使用

1. 在工作台选择“添加内容”，手写 Markdown，或输入网页链接、粘贴微信正文。
2. 在收件箱点击“整理”。默认使用规则提取摘要、标签和中文/英文文本相似度；配置 AI 后使用模型。
3. 在“待审核”编辑标题、摘要、分类、标签和正文，检查来源、相关笔记及代码。
4. 点击“批准发布”。相似度较高的文章需要再次确认。文章写入 `vault/published`，原稿移到本地归档。
5. 提交并推送代码与公开文章，GitHub Actions 构建并部署博客。

已发布文章可以“创建修订稿”，审核后更新同一篇文章。修改冲突会被阻止，避免覆盖在 Obsidian 中的外部修改。归档支持恢复。专题在“已发布”中勾选至少两篇文章后生成。

删除文章：在本地工作台“已发布”中打开文章，点击垃圾桶按钮并确认。文章会移出公开目录，原始文件保存在被 Git 忽略的 `private/trash`，同名待审核稿和原稿不会被删除。删除后运行“更新博客预览”，提交并发布后线上文章才会下架。需要恢复时，可从该本地备份重新导入收件箱并审核发布。

微信支持粘贴正文/链接，不读取微信账号或自动同步微信收藏。需要登录、反爬验证或浏览器渲染才能访问的页面，使用粘贴正文收录。

## Obsidian

在 Obsidian 中选择“打开本地仓库”，打开 **`D:\PersonBlog\vault`**。无需 Obsidian Publish 订阅。

```text
vault/
  inbox/       本地原始内容，默认不提交 Git
  review/      本地待审核稿，默认不提交 Git
  archive/     本地原始稿与历史审核稿，默认不提交 Git
  published/   审核后的文章及公开附件，提交 Git
    assets/
  templates/   Markdown 模板
private/
  state/       操作日志、星数快照、任务锁
  reports/     最近的采集与巡检结果
  cloud/       下载的云端草稿
  qa/          截图、验证记录
config/knowledge.json  网站、来源和限额
scripts/kb/            采集、整理、审核脚本
scripts/studio/        仅本机访问的工作台
```

工作台管理各笔记目录第一层的 `.md` 文件。支持中文文件名；建议以短标题或 `english-slug.md` 命名。Obsidian 的新笔记默认进入 `inbox`。使用模板插件时选择 `templates/note.md`。

私密附件请放在 `vault/inbox` 下；只有准备公开的图片才放入 `vault/published/assets`。默认的附件目录是公开附件目录。不要把整个 Vault 自动同步进公开仓库。

## AI 与搜索

将 `.env.example` 复制为 `.env`，在本机编辑，重启工作台生效。密钥只放本机 `.env` 或 GitHub Secrets。

```dotenv
AI_PROVIDER=openai
AI_API_KEY=你的密钥
AI_MODEL=你的账号可用的模型ID
AI_BASE_URL=https://api.openai.com/v1
```

- `disabled`：不调用 AI，保留原文，生成摘录、基础标签、相关内容建议。专题只生成带引用的资料汇编。
- `openai`：使用官方 Responses API，`store: false`。模型名称由你配置，不预设账户权限和价格。
- `compatible`：使用兼容 Chat Completions 的 HTTPS 服务，须支持 JSON 输出模式。设置对应 `AI_BASE_URL`、密钥和模型。

正文发给 AI 前有长度上限。被截断的输入会在审核页标记，完整原文继续保存在收件箱。失败时保留原稿，不生成假装成功的 AI 结果。相关笔记只从已发布内容中选择，AI 不会获得 `.env` 或全部私密笔记。

配置参考：[OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create/)。

联网发现默认使用 GitHub API 和 RSS，不需要商业搜索密钥。本机已登录 `gh` 时会使用它的 GitHub 凭据提高访问额度，也可设置 `GITHUB_TOKEN`。搜索可选 Brave 或 Tavily：在工作台设置服务和关键词，在 `.env` 填写 `SEARCH_API_KEY`。具体额度与费用由对应服务决定。

## GitHub 热门项目的定义

优先读取 GitHub Trending 月榜，筛选当前总 Stars **大于 10,000** 的项目，保留页面报告的 `stars this month` 与来源。月榜是 GitHub 的精选排名，非全站完整增长榜；页面结构变化时会报告错误并保留另外两组查询。

同时查询近 30 天创建且当前 Stars 大于 10,000 的仓库，以及近 30 天有推送且总 Stars 大于 10,000 的项目。三组结果分别标注，“近期有推送”不声称月增长。

GitHub 仓库搜索返回当前星数，不返回可靠的历史月增长。本项目保存每日快照；存在 30–38 天前的快照时显示实际区间差值，否则显示“历史不足”。新建且超过 10k 的项目可能一个也没有，这属于有效结果。

星数快照保存在 `private/state/github-stars.json`，云端使用 Actions Cache 保存。缓存可能被清理，因此不能把它当作永久历史数据库；清理后会重新积累。Topics 多个值采用全部匹配。

## 巡检与周记

- 链接检查将 404/410 标为失效；403、429、超时、网络拦截标为待确认，不直接当成死链。
- 超过 `staleDays` 天未更新/复核的笔记进入复核列表。这是时间提醒，不声称自动证明知识已经错误。
- 链接检查有上限并轮流检查；可在 Markdown 属性中更新 `lastVerified`。
- 相似度基于中文双字片段与英文词频余弦相似度，不等于语义理解；高相似项只提示，不自动删除。
- 周记汇集上一完整周（UTC 周一至周日）首次发布的笔记，生成待审核稿；修订旧文章不计入新增。
- 专题可以手动选择多篇笔记生成，保留原始笔记链接。规则模式保留“我的综合理解”待填写。

## 部署 GitHub Pages

项目已保留 Quartz 上游为 `upstream`，本地开发分支为 `codex/personblog`。尚未替你创建公开仓库或上传资料。

在 GitHub 新建自己的仓库，源代码使用 `main` 分支。普通免费个人账号使用公开仓库部署 Pages；私有仓库的 Pages 能力取决于账户计划。公开仓库中的源码、公开文章、Actions 草稿产物和缓存中的公开采集资料可能被他人读取，所以定时任务只采集你愿意公开的来源。

```powershell
cd D:\PersonBlog
git remote add origin https://github.com/你的用户名/你的仓库.git
git add .
git commit -m "Build personal knowledge blog"
git push -u origin HEAD:main
```

仓库 `Settings -> Pages -> Build and deployment -> Source` 选择 **GitHub Actions**，再手动运行 `Publish knowledge blog`（首次未开启 Pages 时的失败可以重跑）。公开内容默认出现在 `https://用户名.github.io/仓库名/`；仓库为 `用户名.github.io` 时出现在域名根目录。

在工作台“设置”填入 GitHub 仓库 `用户名/仓库名`，保存后提交配置。定时任务只在默认分支执行：

- 每天北京时间 09:23：采集公开来源并整理。
- 每周一北京时间 10:37：巡检并生成周记。
- GitHub 的定时触发可能延迟；公共仓库长期无活动时定时任务可能被停用，可在 Actions 中重新启用。

在仓库 `Settings -> Secrets and variables -> Actions` 设置：

| 位置      | 名称             | 用途                                 |
| --------- | ---------------- | ------------------------------------ |
| Variables | `AI_PROVIDER`    | `disabled` / `openai` / `compatible` |
| Variables | `AI_MODEL`       | 模型 ID                              |
| Variables | `AI_BASE_URL`    | 可选，API 地址                       |
| Secrets   | `AI_API_KEY`     | AI 密钥                              |
| Secrets   | `SEARCH_API_KEY` | 可选，搜索密钥                       |

定时任务**不提交或发布草稿**，生成保留 30 天的 `knowledge-review` Artifact。工作台“采集任务 -> 同步云端草稿”会通过已登录的 `gh` 下载最近 10 次成功运行中的新草稿；相同来源不重复导入，也不会覆盖本地修改。也可在 Actions 手动下载产物查看。

### 绑定自己的域名

仓库 `Settings -> Pages -> Custom domain` 填 `notes.example.com`；DNS 配置 CNAME，`notes` 指向 `用户名.github.io`（不带仓库路径），生效后启用 HTTPS。部署工作流会使用 Pages 返回的域名构建正确链接。也可以在配置中填入域名供本地构建使用。

工作台仅监听 `127.0.0.1`，不会部署到 Pages。访问者可以阅读博客、搜索和查看知识图谱，不能操作你的收件箱或调用 AI。

## 脚本与验证

```powershell
npm run kb -- capture https://example.com/article
npm run kb -- import "D:\资料\文章.md"
npm run kb -- organize 笔记ID
npm run kb -- approve 笔记ID
npm run kb -- collect
npm run kb -- health
npm run kb -- weekly
npm run kb -- topic "专题标题" 笔记ID1 笔记ID2
npm run kb -- import-cloud
npm run test:kb
npx tsc --noEmit
npm run build
```

UI 验证使用 Playwright，浏览器保存在项目目录：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\PersonBlog\.playwright'
npx playwright install chromium
npm run test:ui
```

测试使用 `private/test-runs` 中的隔离知识库，不发布测试笔记。锁文件防止工作台、CLI 同时修改资料。进程意外退出后，确认没有运行中的任务，再移除 `private/state/operation.lock`。

## 备份与素材

Git 备份公开文章与代码。收件箱、归档、`.env` 和 Obsidian 配置默认被 Git 忽略，请另外备份 `vault` 与 `private` 到自己的私密存储。

首页保留知识图谱与壁纸，知识文章由本地工作台审核发布。书架素材来自 [Unsplash 原图](https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1400&q=85&fit=crop)，本地文件为 `vault/published/assets/library.jpg`。Quartz 原始 MIT 许可证保存在 `LICENSE.txt`，上游文档在 `docs`。
