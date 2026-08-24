# 读本 READBOOK

每日人民日报深度内容与申论素材的精读工作台。从 `design/` 静态 HTML 原型（视觉已验收）转换而来的 Vite + React + TypeScript 应用，首版数据层使用 `localStorage`，后续可通过替换 Repository 数据访问层接入后端。

## 快速开始

```bash
npm install        # 安装依赖（使用项目内缓存 .npm-cache）
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 类型检查 + 生产构建（输出 dist/）
npm run preview    # 预览生产构建
```

## 技术栈

- **Vite 8 + React 19 + TypeScript 7**
- **React Router 7** —— 五个页面路由，浏览器前进后退，刷新保持
- **Zustand 5**（`persist` 中间件）—— 状态管理 + localStorage 持久化
- **Lucide React** —— 工具栏/操作图标
- **CSS Variables** —— 沿用设计稿的令牌系统与四套主题（未引入 Tailwind，保持与设计稿一致的排版语言）
- 字体：DM Mono / DM Sans / Noto Sans SC / Noto Serif SC / Ma Shan Zheng / LXGW WenKai（Google Fonts）

## 页面路由

| 路由 | 页面 | 对应设计稿 |
|---|---|---|
| `/` | 首页工作台（今日推荐、继续阅读、最近阅读） | `design/app.html` 首页部分 |
| `/library` | 文章库（搜索 / 主题 / 来源 / 状态筛选 / 排序 / 分页） | `design/library.html` |
| `/reading/:articleId` | 阅读正文（进度、字号、主题、高亮 / 下划线 / 笔记） | `design/reading.html` |
| `/notes` | 我的摘录（三栏：筛选 / 列表 / 详情，批量操作、导出） | `design/notes.html` |
| `/settings` | 设置（字体、字号、行高、主题、动效、数据导出 / 清空） | `design/settings.html` |

文章库的搜索状态同步到 URL（`/library?q=基层治理&topic=民生保障&page=2`），刷新后筛选条件不丢失。

## 架构

```
localStorage（persist 中间件）
     ↓
Zustand stores（数据访问层，可替换为 REST API / Supabase / Firebase）
     ↓
React 页面组件
```

### 状态拆分

- `useArticleStore` —— 文章数据、阅读进度、收藏（`readbook:articles`）
- `useReaderStore` —— 字号 / 行高 / 字体 / 阅读主题 / 减少动效 / 显示标注（`readbook:reader`）
- `useAnnotationStore` —— 高亮 / 下划线 / 笔记统一模型（`readbook:annotations`）
- `useThemeStore` —— 页面主题（`readbook:theme`）

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

四套主题与 `design/palettes.html` 一致，通过 `data-theme` 属性切换：

| 主题 | 名称 | 关键色 |
|---|---|---|
| `paper` | 暖纸 | `--paper:#f4f0e9 --ink:#181817 --accent:#e96448` |
| `blue` | 冷蓝 | `--paper:#e9edf4 --accent:#667ff0` |
| `night` | 夜读绿 | `--paper:#20221f --accent:#d7f267` |
| `violet` | 柔紫 | `--paper:#ebe8f6 --accent:#aa7bff` |
| `graphite` | 墨夜 | `--paper:#101114 --accent:#d9ff5a`（提炼自 `design/2026-direction.html`） |

阅读页可设置独立的「阅读主题」覆盖页面主题（设置 → 显示与主题）。设置页可开启「自动夜读」：系统进入深色模式时自动切换到夜读绿。

## 设计优化

- **视觉**：小字 muted 色加深至 WCAG AA 对比度；中文标题负字距放宽（-0.02em 左右），数字保持紧排；全局等宽数字（tabular-nums），进度/页码变化不抖动
- **动效**：路由切换淡入过渡、数字滚动组件（Ticker）、文库列表加载骨架屏——全部尊重「减少动效」设置
- **阅读体验**：段落聚焦模式（当前段落全彩，其余淡化）、版面宽度收窄（约 40 字/行）、段首缩进开关、打印样式（白底黑字存档版式）

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

- 数据源：`data/articles.db`（SQLite，517 篇），随部署打包
- 运行时读取：Vercel Function `/api/articles`（node:sqlite 只读）→ 前端按需拉取
  - `GET /api/articles` → meta 列表（不含正文，供首页/文库/搜索）
  - `GET /api/articles?id=p0001` → 单篇全文（阅读页按需）
- 本地开发：`node scripts/api-server.mjs` 提供同路由 API（Vite dev 已配置 `/api` 代理）
- Word 导入功能已移除（不再解析 docx）

## 端到端冒烟测试

`scripts/e2e-smoke.mjs` 用本机 Microsoft Edge 无头模式跑通核心链路（94 项断言，自动拉起本地 API server）：

```bash
npm i -D playwright-core          # 需要本机安装 Microsoft Edge
npm run dev                       # 先启动开发服务器
node scripts/e2e-smoke.mjs
```

覆盖：五个路由渲染、搜索写 URL 与刷新保持、滚动进度持久化、高亮 / 下划线 / 笔记全流程、摘录搜索与打开原文、主题切换与跨页保持、字号持久化、刷新后数据仍在。
