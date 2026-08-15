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

阅读页可设置独立的「阅读主题」覆盖页面主题（设置 → 显示与主题）。

## 首版完成标准对照

- [x] 所有页面正常跳转（React Router，前进后退）
- [x] 文章库搜索与筛选（标题 / 摘要 / 主题 / 来源 / 状态，状态入 URL）
- [x] 阅读页记录进度（滚动计算百分比、节流 + 尾部保存、离开页面保存、恢复上次位置）
- [x] 调节字号（A−/A+，14–22px）与主题
- [x] 选择文字并高亮、添加下划线
- [x] 正文中添加笔记（锚点 + inline note，可编辑 / 删除）
- [x] 刷新后数据仍然存在（localStorage）
- [x] 摘录可在「我的摘录」查看（搜索 / 主题筛选 / 日期分组 / 详情 / 标签 / 删除 / 批量 / 导出 JSON）
- [x] **文章管理**（`/admin`：录入 / 编辑 / 删除本地文章，入口在文章库工具栏与设置页；支持 **Word (.docx) 导入**，自动解析标题与段落填入表单；文章存 IndexedDB 与 mock 种子合并）
- [x] 数据**导入 / 导出**（设置页整包导出含主题、阅读设置、**文章正文**、进度、摘录；导入兼容整包格式与摘录数组格式，文章按 id 覆盖/追加、进度按文章合并、摘录按 id 去重，可跨设备迁移）
- [x] 首页显示继续阅读状态（继续阅读主卡 + 最近阅读）

文章数据：**517 篇人民日报评论年编 2025**（人民时评 191 / 人民论坛 128 / 人民观点 20 / 评论员观察 175，解析自 Word 年编文档，已移除最初的 24 篇 demo 数据）。

### 文章数据管线（Word → SQLite → 源码）

```bash
npm run db:import   # 解析 /Users/nif/Documents/人民时评/*.docx → data/articles.db（SQLite，node:sqlite 零依赖）
npm run db:gen      # 从 data/articles.db 生成 src/data/articlesParsed.ts（写入源码）
npm run db:all      # 两步一起
```

- 解析规则：按「（20xx年x月x日）」行切分文章；标题 / 作者行 / 导语（短行无句号）/ 正文分段自动识别；标题关键词自动归类到 12 个主题
- SQLite 表 `articles(id, title, summary, source, topic, date, column_name, content_json, read_time, …)` 为规范数据源，生成的 `articlesParsed.ts` 是应用实际读取的源码
- 应用内不再解析 Word（已移除运行时 mammoth 导入）；文章仅来自 SQLite 生成数据，无 demo 内容

## 端到端冒烟测试

`scripts/e2e-smoke.mjs` 用本机 Microsoft Edge 无头模式跑通核心链路（31 项断言）：

```bash
npm i -D playwright-core          # 需要本机安装 Microsoft Edge
npm run dev                       # 先启动开发服务器
node scripts/e2e-smoke.mjs
```

覆盖：五个路由渲染、搜索写 URL 与刷新保持、滚动进度持久化、高亮 / 下划线 / 笔记全流程、摘录搜索与打开原文、主题切换与跨页保持、字号持久化、刷新后数据仍在。
