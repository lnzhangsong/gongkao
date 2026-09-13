# 读本 READBOOK

每日人民日报深度内容与申论素材的精读工作台，并叠加国考**申论真题溯源**与**行测刷题**两条练习线。从 `design/` 静态 HTML 原型（视觉已验收）转换而来的 Vite+ / React / TypeScript 应用：数据**本地优先**（Zustand + IndexedDB / localStorage），登录后可按账号**云同步**（Supabase Auth + Postgres，按行 LWW），未配置 Supabase 时整站仍可离线单机使用。

## 快速开始

```bash
vp install         # 安装依赖（vp 统一封装，包管理器仍是 pnpm）
vp dev             # 开发服务器 http://localhost:5173（API 另起：vp run dev:api，或 vp run dev:all 一键双起）
vp test run        # 单元测试（watch：vp test）
vp check           # 格式化 + lint + 类型检查
vp run gate        # push 前门禁：check + test + build（pre-push 钩子自动跑的就是它）
vp run build       # 类型检查 + 生产构建（输出 dist/）
vp preview         # 预览生产构建
```

> 工具链是 **Vite+**（`vp` 单 CLI 包办 Vite / Vitest / Oxlint / Oxfmt），不是裸 Vite，也不直接跑 pnpm；`vp` 内部用 pnpm 管依赖。约定见 `AGENTS.md`。

## 技术栈

- **Vite+（vp）+ Vite 8 + React 19 + TypeScript 5** —— 构建 / 测试 / lint / 格式化单 CLI
- **React Router 7** —— 页面路由（含 `/practice` 行测线、`/login`），前进后退，刷新保持；`/account` 保留为旧链接重定向
- **Zustand 5**（`persist` 中间件）—— 状态管理；数据本地优先，localStorage（轻量）+ IndexedDB（文章、学习事件、行测作答）
- **Supabase**（可选）—— Auth 登录 + Postgres 云同步；未配置环境变量时自动降级为纯本地。SDK 约 55KB gzip，按需动态加载（登录态另存轻量 `authStatus` store），**不进首屏 bundle**
- **PostHog**（可选）—— 产品埋点（pageview + 白名单功能事件）；走官方 **slim 构建**（约 47KB gzip，完整构建约 92KB，用不到 session recording / surveys / feature flags），空闲时动态加载，不上报 PII。未配置 `VITE_POSTHOG_KEY` 时整体静默禁用
- **Lucide React** —— 工具栏/操作图标
- **CSS Variables** —— 令牌系统与五套主题（paper/blue/violet/night/graphite，未引入 Tailwind；2026-09 起按 Paper OS 收敛：圆角 10/16 两档、7×8 硬阴影、1180 版心，见 `design/design/DESIGN.md`）
- 字体：**界面拉丁字体（DM Sans / DM Mono）与装饰标题字体（马善政楷书）、阅读字体（仓耳今楷 / 霞鹜文楷）均自托管**（`public/fonts` + @fontsource，随构建产出，不依赖外部 CDN）；思源宋体 / 思源黑体字库过大（单字族 30MB+），保留 jsDelivr CDN 按需注入并回退系统字体栈

## 页面路由

| 路由 | 页面 | 对应设计稿 |
|---|---|---|
| `/` | 首页工作台（今日推荐、继续阅读、最近阅读、复习队列） | `design/pages/app.html` 首页部分 |
| `/library` | 文章库（搜索 / 主题 / 来源 / 状态筛选 / 排序 / 分页） | `design/pages/library.html` |
| `/reading/:articleId` | 阅读正文（进度、字号、主题、高亮 / 下划线 / 笔记、申论拆解） | `design/pages/reading.html` |
| `/notes` | 我的摘录（三栏：筛选 / 列表 / 详情，批量操作、导出） | `design/pages/notes.html` |
| `/settings` | 设置（账号资料与云同步、字体、字号、行高、主题、动效、AI 服务、数据导出 / 清空） | `design/pages/settings.html` |
| `/exams` + `/exams/:examId` | 国考申论真题（材料/题目/参考答案对照，可编辑）+ 答案溯源解析 | 2000–2025 统一由 `scripts/parse-shenlun-pdf.py`（PDF→`data/shenlun/*.json`）+ `scripts/import-shenlun.mjs`（入库）维护 |
| `/practice` + `/practice/:paperId` | 行测刷题（答题卡、判分、解析、计时） | 2026 卷由 `scripts/parse-xingce26.py`；2000–2025 卷由 `scripts/parse-xingce-pdf.py`（真题+答案解析双 PDF → `data/xingce/*.json`）+ `scripts/import-xingce.mjs`（入库），当前 2022 三卷已接入、其余年份整理进行中；设计与缺口见 `docs/行测做题模块设计方案.md` |
| `/practice/wrong` | 行测错题本（接入复习队列，到期重做） | 同上 X3 |
| `/terms` | 申论规范词库（1070+ 词，按主题检索） | `scripts/import-guifanci.mjs` 入库 |
| `/assist` | AI 审题立意 + 作答框架 + 反向考点联想/出题（BYOK） | `docs/申论写作AI辅助设计方案.md` |
| `/admin` 系列 | 文章管理（列表 + 录入/编辑编辑器） | — |
| `/login` | 登录（账号资料、同步状态、退出登录已并入 `/settings#account`） | `sql/profiles.sql` · `sql/sync.sql` |

> 全部进度（P1–P7、AI 线、Paper OS 设计系统落地）**以 `docs/README.md` 的路线图表为唯一真源**；设计系统规范见 `design/design/DESIGN.md`。

文章库的搜索状态同步到 URL（`/library?q=基层治理&topic=民生保障&page=2`），刷新后筛选条件不丢失。

## 架构

```
API /api/*（Vercel Function · node:sqlite 只读：文章 / 真题 / 行测 / 规范词）
     ↓
Zustand stores（数据访问层，本地优先）
     ↓  persist 中间件
IndexedDB / localStorage
     ↓  登录后（可选）
Supabase（Auth + Postgres，按行 LWW 云同步，见 sql/sync.sql）
     ↓
React 页面组件
```

### 状态拆分

- `useArticleStore` —— 文章数据、阅读进度、收藏、本地编辑（`readbook:articles`）
- `useReaderStore` —— 字号 / 行高 / 字体 / 阅读主题 / 减少动效 / 显示标注（`readbook:reader`）
- `useAnnotationStore` —— 高亮 / 下划线 / 笔记统一模型 + 素材类型（`readbook:annotations`）
- `useThemeStore` —— 页面主题（`readbook:theme`）
- `useShenlunStore` —— 文章拆解 / 范文精读 / 学习状态
- `useExamStudyStore` —— 申论真题答案溯源 + 原文标注（`trace#paperId#qIdx` / `mark#paperId#qIdx`）
- `useXingceStore` —— 行测作答（`paperId#qIdx`）
- `useLearningEventStore` —— 学习事件流水（append-only，复习算法底座）
- `useAiStore` / `useAiAssistStore` —— BYOK 配置 / AI 审题作答记录
- `useAuthStatusStore` —— 登录态（轻量，首屏用）；`useAuthStore` —— 认证动作与云同步启停（重，按需加载）

### 数据模型

```ts
type Article = { id, title, summary, content: string[], source, topic, date, readTime, featured? }
type ReadingProgress = { articleId, percent, lastPosition, lastReadAt, completed, startedAt, readCount, favorite }
type ReaderSettings = { fontSize, lineHeight, fontFamily, readerTheme, reducedMotion, showAnnotations }
type Annotation = { id, articleId, kind: 'highlight' | 'underline' | 'note', text, start, end, createdAt, noteText?, tags? }
```

## 标注系统原理（核心）

正文按段存储，扁平化后（段落以 `\n` 连接）得到全局字符偏移。标注通过 `start/end` 偏移定位，不依赖 DOM 坐标：

1. 选中文字 → `computeSelectionRange` 用 TreeWalker 把 selection 换算成段落内字符偏移 + 全局偏移（`src/lib/offsets.ts`）
2. 保存 `{ start, end, text }` 到 annotationStore（持久化）
3. 重新打开文章 → `splitParagraph` 按偏移把每段切成片段，包上 `<mark class="highlighted">` / `<u class="underlined">` / `<span class="note-mark">`（✦ 锚点）

- 高亮：支持 **5 种颜色**（暖黄 / 冷蓝 / 松绿 / 樱粉 / 柔紫），划词弹出工具栏时点色点即高亮，也可先选色再用「高亮」按钮；颜色随标注持久化，夜读主题下自动转半透明；下划线：3px 橙色底线；笔记：正文锚点 + 点击展开的 inline note
- 笔记锚点默认收起，不打断连续阅读
- **原文内删除**：点击正文中的高亮/划线会弹出「删除标注」操作；笔记点击 ✦ 锚点展开后，在 inline note 头部可编辑 / 删除
- 设置页「显示划线」开关可隐藏全部标注

## 主题

四套基础主题与 `design/explorations/palettes.html` 一致，graphite 墨夜来自 `2026-direction.html`，通过 `data-theme` 属性切换：

| 主题 | 名称 | 关键色 |
|---|---|---|
| `paper` | 暖纸 | `--paper:#f4f0e9 --ink:#181817 --accent:#e96448` |
| `blue` | 冷蓝 | `--paper:#e9edf4 --accent:#667ff0` |
| `night` | 夜读绿 | `--paper:#20221f --accent:#d7f267` |
| `violet` | 柔紫 | `--paper:#ebe8f6 --accent:#aa7bff` |
| `graphite` | 墨夜 | `--paper:#101114 --accent:#d9ff5a`（提炼自 `design/explorations/2026-direction.html`） |

阅读页可设置独立的「阅读主题」覆盖页面主题（设置 → 显示与主题）。设置页可开启「自动夜读」：系统进入深色模式时自动切换到夜读绿。

## 设计优化

- **视觉**：小字 muted 色加深至 WCAG AA 对比度；中文标题负字距放宽（-0.02em 左右），数字保持紧排；全局等宽数字（tabular-nums），进度/页码变化不抖动
- **动效**：路由切换淡入过渡、数字滚动组件（Ticker）、文库列表加载骨架屏——全部尊重「减少动效」设置
- **阅读体验**：段落聚焦模式（当前段落全彩，其余淡化）、段首缩进开关、打印样式（白底黑字存档版式）

## 首版完成标准对照

- [x] 所有页面正常跳转（React Router，前进后退）
- [x] 文章库搜索与筛选（标题 / 摘要 / 主题 / 来源 / 状态，状态入 URL）
- [x] 阅读页记录进度（滚动计算百分比、节流 + 尾部保存、离开页面保存、恢复上次位置）
- [x] 调节字号（A−/A+，14–22px）与主题
- [x] 选择文字并高亮、添加下划线
- [x] 正文中添加笔记（锚点 + inline note，可编辑 / 删除）
- [x] 刷新后数据仍然存在（localStorage）
- [x] 摘录可在「我的摘录」查看（搜索 / 主题筛选 / 日期分组 / 详情 / 标签 / 删除 / 批量 / 导出 JSON）
- [x] **文章管理**（`/admin` 列表页 + `/admin/new`、`/admin/edit/:id` 独立编辑器：搜索 / 分页 / 删除在列表页，录入与编辑在编辑器页；年编文章来自 API 只读，本地录入/编辑存 IndexedDB）
- [x] 数据**导入 / 导出**（设置页整包导出含主题、阅读设置、**文章正文**、进度、摘录；导入兼容整包格式与摘录数组格式，文章按 id 覆盖/追加、进度按文章合并、摘录按 id 去重，可跨设备迁移）
- [x] 首页显示继续阅读状态（继续阅读主卡 + 最近阅读）

文章数据：**517 篇人民日报评论年编 2025**（人民时评 191 / 人民论坛 128 / 人民观点 20 / 评论员观察 175）。

### 文章数据（SQLite → API）

- 数据源：`data/articles.db`（SQLite，517 篇）——**构建产物，由 `data/` 下的可读源在构建期生成，不提交**
- 运行时读取：Vercel Function `/api/articles`（node:sqlite 只读）→ 前端按需拉取
  - `GET /api/articles` → meta 列表（不含正文，供首页/文库/搜索）
  - `GET /api/articles?id=p0001` → 单篇全文（阅读页按需）
- 本地开发：`node scripts/api-server.mjs` 提供同路由 API（Vite dev 已配置 `/api` 代理）
- Word 导入功能已移除（不再解析 docx）
- **部署约束（重要）**：`data/articles.db` 必须处于**回滚日志（DELETE）模式，绝不能是 WAL**。
  Vercel 的函数目录只读，而 WAL 库即使以 `readOnly: true` 打开也要创建 `-wal` / `-shm` 旁路文件，
  只读盘上直接 `SQLITE_CANTOPEN` —— 线上表现为 `/api/*` 全部报 `unable to open database file`。
  历史上正是导入脚本里的 `PRAGMA journal_mode = WAL` 把 WAL 标志写进文件头、随库一起提交造成的。
  现在两个导入脚本都显式设 `DELETE` 并在结束时断言，`src/lib/dbArtifact.test.ts` 另读文件头做守卫。

### 数据库的可读源与重建（`data/` 是源，`articles.db` 是产物）

`articles.db` 里的每一行都可由仓库内的可读源推导出来：

```bash
vp run db:rebuild                             # = node scripts/rebuild-db.mjs，重建 data/articles.db
node scripts/rebuild-db.mjs --db /tmp/x.db    # 重建到别处（用于与现库比对）
```

| 源 | 表 |
|---|---|
| `data/shenlun/*.json` | `papers` / `materials` / `questions` |
| `data/xingce/*.json` | `xg_papers` / `xg_questions` |
| `data/articles/{id}.json`（517 篇，每篇一个文件） | `articles` |
| `data/guifan-terms.json`（3039 条，保留 id 空洞） | `guifan_terms` |
| 派生（`migrate-fts.mjs`） | `articles_fts`（trigram FTS5） |

- 后两份源是 2026-09-13 用 `scripts/migrate-db-to-source.mjs` 从库里反导出来的：它们的原始
  上游在**仓库外**（年编 docx 在 `/Users/nif/…`，规范词合集 md 同样），此前 DB 是唯一副本。
- `src/lib/dbSource.test.ts` 守卫「源 ↔ 库」逐字段一致；`DB_REBUILD_CHECK=1 vp test run`
  再验证「从源重建的库与现库逐表逐列一致」（`created_at` 是入库时间戳，不参与比对）。
- **`data/articles.db` 不再提交进 git**（`.gitignore` 忽略）——它是构建产物，仓库里进 git 的是
  `data/` 下的可读源。clone 下来后 `scripts/ensure-db.mjs` 会在库缺失时自动重建：
  `vp run build` / `vp run test run` / `pnpm dev:api` / `pnpm dev:all` 都会触发，也可手动
  `vp run db:rebuild`。Vercel 侧由 `vercel.json` 的 `buildCommand: pnpm build` 保证在打包
  Functions（`includeFiles: data/articles.db`）之前库已生成。
- 注意：`vp run db:rebuild` 直接改写 `data/articles.db`（逻辑与源一致，字节因 `created_at`
  与页面布局不同）。只想比对请用 `node scripts/rebuild-db.mjs --db /tmp/x.db`。
- git 历史里仍留着旧的 DB 快照（23 版、未压缩 360MB）；要回收需重写历史，属独立动作（未做）。

## 端到端冒烟测试

`scripts/e2e.mjs` 一键入口：清理端口 → 拉起 `vp dev` → 运行 `scripts/e2e-smoke.mjs`（用本机 Microsoft Edge 无头模式跑通核心链路，脚本结束打印实际断言项数）：

```bash
vp add -D playwright-core          # 需要本机安装 Microsoft Edge
vp run test:e2e                    # 一键：自动起服务 + 跑冒烟 + 收尾
```

覆盖：路由渲染、搜索写 URL 与刷新保持、滚动进度持久化、高亮 / 下划线 / 笔记全流程、素材标记与申论拆解、摘录搜索与打开原文、主题切换与跨页保持、字号持久化、数据导入合并、**行测刷题（列表 → 答题 → 判分 → 刷新后持久化 → 错题本）**、**登录页与旧 `/account` 深链到 `/settings#account` 的重定向**、导航入口。共 130+ 项断言（脚本结束打印实际项数）。

> 尚未覆盖：真实 Supabase 的登录 / 退出与 RLS、触发器实际行为（需真实项目或测试账号）。
> 云同步**引擎本身**已有 mock Supabase 的集成测试（`src/lib/cloudSync.test.ts`，8 项：push/pull 往返、LWW 应用、墓碑删除、`exam_study` 复合键、坏记录拒入、登出解绑订阅、并发串行化），随 `vp test run` 一起跑，不触网。

## 代码质量与本地门禁

- **push 前门禁（本地）**：`.vite-hooks/pre-push` 是项目自有钩子（Vite+ 机制：`core.hooksPath=.vite-hooks/_`，由 `pnpm install` 的 `prepare: vp config` 自动接好），push 时自动跑 `vp run gate`——即 `vp check`（格式 / lint / 类型）→ `vp test run`（32 文件 / 270 项，另有 1 项 `DB_REBUILD_CHECK` 可选项默认跳过）→ `vp run build`，任一失败即中断 push。手动预跑：`vp run gate`；临时跳过：`git push --no-verify`。
- **commit 前**：`vp staged` 对暂存文件跑 `vp check --fix`（规则见 `vite.config.ts` 的 `staged`）。
- **Node 版本**由 `.nvmrc` + `package.json` 的 `engines` 固定（`node:sqlite` 需 ≥22.5）。
- **lint 覆盖 jsx-a11y**：语义/标签关联/aria 等真实可达性问题纳入门禁；自定义 dialog/listbox 与模态 autofocus 两条纯风格规则关闭（见 `vite.config.ts` 注释）。
- **API 端点有集成测试**：`api/*.test.ts` 直接调用 Vercel Function 的 `GET`，读真实 `articles.db`（含搜索走 FTS5 与本地 `api-server` 行为一致的断言）。
- **安全响应头 / CSP**：`vercel.json` 注入 CSP、`X-Content-Type-Options`、`Referrer-Policy`、HSTS 等；`/assets`、`/fonts` 带一年不可变缓存。
- **线上搜索走 FTS5**：`api/articles.ts` 与本地 `scripts/api-server.mjs` 同用 `articles_fts` trigram 索引（≥3 字符），短词回退 LIKE——两处逻辑需同步修改（注释已标注）。

## 账号体系与云同步（Supabase 全托管：Auth + Postgres）

- 认证：Supabase Auth（邮箱密码 + 魔法链接免密登录），前端 SDK `@supabase/supabase-js`，session 由 SDK 持久化在 localStorage
- 资料：Supabase Postgres 的 `public.profiles` 表（昵称等）；RLS 行级权限保证每人只能读写自己的行，anon key 可公开
- **云同步**（`sql/sync.sql`）：登录后把本机各 store 数据按行 upsert 到 Postgres，多设备一致。策略为**按行 LWW**（最后写入胜出）：
  - 行表 9 张：`reading_progress` / `annotations`（删除走墓碑）/ `article_study` / `exam_study`（`kind+key` 复合主键）/ `learning_events`（append-only）/ `ai_assists` / `article_edits` / `xg_answers`，另有单行整包 `user_prefs` / `user_ai_config`
  - 编辑触发**只推不拉**（`runPush`，4s 防抖）；登录首轮 / 窗口聚焦 / 手动「立即同步」才跑全量 push+pull（`runSync`）。两者共用一条串行队列，不会并发写 meta
  - `updated_at` 由数据库 `now()` 赋值（`sql/sync.sql` v4 触发器），客户端不拿墙钟当权威，避免设备时钟偏差误判新旧
  - 退出登录：停同步 → 清空本机全部用户数据（含行测作答）与同步时间戳 → 登出；换账号共用浏览器不串数据
- 页面：`/login`（仅登录，注册已关闭）；账号资料、同步状态与退出登录在**设置页的「账号」分区**（`/settings#account`）。导航栏保留账号图标作为该分区的深链入口；`/account` 保留为旧链接（含邮件回跳）重定向

### 开通步骤

1. 创建 [Supabase](https://supabase.com) 项目，拿到 Project URL 与 anon key；如需免邮箱确认，在 Auth → Providers → Email 关闭 "Confirm email"
2. Supabase 控制台 → SQL Editor → 依次粘贴执行 `sql/profiles.sql`（profiles 表 + RLS + 注册建行触发器）与 `sql/sync.sql`（同步表 + RLS + 时间戳触发器；幂等，可重复执行）
   - **已建过库的必须重跑 `sql/sync.sql`**：一是补上 v4 时间戳触发器（不跑也能用，只是退回客户端时间戳），
     二是**删除已废弃的 `app_events` 埋点表**——该表带一条「任何人可 insert」的宽松策略，
     配合公开的 anon key 等于一个对外公开写入口，只改代码不会关掉它，必须执行 DDL
3. 配置环境变量（参考 `.env.example`）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`
4. Supabase Auth → URL Configuration 里把站点域名（本地 `http://localhost:5173` 与线上域名）加入 Redirect URLs，魔法链接与邮箱确认链接才能回跳

两项 Supabase 环境变量缺省时，登录入口仅显示「未配置」提示，站点其余功能完全不受影响。

### 产品埋点（可选）

PostHog 云（美区）承载 pageview 与一组白名单功能事件，**不采集任何个人身份信息**
（不传邮箱/昵称/正文/笔记内容），事件清单与隐私策略见 `docs/产品埋点设计方案.md`。

1. 在 [PostHog](https://posthog.com) 注册项目（美区），拿 Project API Key（`phc_…`）
2. 在 `.env` / `.env.local` 与 Vercel 项目环境变量里填 `VITE_POSTHOG_KEY=phc_…`
   （`VITE_POSTHOG_HOST` 留空即可）
3. 上报走自身域名 `/ingest` 反代（`vercel.json` rewrite + `vite.config.ts` dev proxy），
   既避开广告插件拦截，也免去国内直连的跨境延迟

`VITE_POSTHOG_KEY` 缺省时整个埋点模块静默禁用：不加载 SDK、不发请求、不报错，功能完全不受影响。

### 运维备注（Supabase 免费版）

- **注册已关闭**：登录页仅保留登录与魔法链接入口（`AuthPage` 无注册流程）。Supabase 侧也建议关闭：Authentication → Sign In / Providers → Email → 关闭 "Allow new users to sign up"（双保险，防止有人直连 API 注册）
- **防项目休眠**：免费版 7 天无 API 请求项目会被暂停。已配 GitHub Actions 每日自动 ping（`.github/workflows/supabase-keepalive.yml`），需在仓库 Settings → Secrets 添加 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY`
