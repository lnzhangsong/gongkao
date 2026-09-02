# design / 设计原型

静态 HTML 原型与方向探索稿。应用本体在 `src/`，这里是视觉验收的依据。

## design/ —— Paper OS 设计系统（2026-09 新增，当前视觉真源）

OpenDesign 生成的「Paper OS」系统工作区，源自统一前沿提案 `design/design/readbook-unified-frontier.html`（578 行长页）。**新页面/改版以此为准**，旧原型（pages/explorations）仅留档：

| 路径 | 内容 |
|---|---|
| `design/DESIGN.md` | 系统总纲 0–9 章：颜色 6 变量 / 三字体栈 / 8pt 间距 / 10·16 圆角 / 7×8 硬阴影 / 组件 / 动效 / 文案 / 12 条反模式 |
| `design/SKILL.md` | `readbook-paper-os` skill：新页面按此执行 |
| `design/colors_and_type.css` | 可粘贴令牌（与 `src/styles/tokens.css` 对齐） |
| `design/readbook-unified-frontier.html` | 源提案长页（单文件可跑，证据真源） |
| `design/examples/` | 最小可复用片段：tokens / hero-shell / bento / states |
| `design/preview/` | 8 张聚焦走查卡（颜色/字体/间距/圆角阴影/按钮/卡片/表面/品牌） |
| `design/ui_kits/app/` | 可交互四页套件：index + home + archive + reading + notes |
| `design/context/` | 复制清单与令牌逐行溯源（provenance） |
| `design/assets/ · build/ · fonts/` | 资源落位约定（源未提供位图字标，文字实现） |

> 落地状态（2026-09-03）：Phase 1「令牌收敛 + 版式统一」已合入 `src/styles/`（`--radius-sm/lg`、`--shadow-hard`、`--container`、`--danger`、顶栏玻璃 14px saturate），见 `docs/设计与体验优化清单.md` 第十节。Phase 2/3（玻璃标注层、Bento 网格化、⌘K）未实施。

## pages —— 页面原型（已验收，与路由一一对应；视觉细节已被 Paper OS 收敛部分取代）

| 文件 | 对应路由 | 说明 |
|---|---|---|
| `app.html` | `/`（首页部分）+ 全站 | 整站单页预览：首页 / 文库 / 摘录 / 设置锚点串联 |
| `library.html` | `/library` | 文章库：筛选、搜索、排序、列表 |
| `reading.html` | `/reading/:articleId` | 阅读正文：标注、工具栏、进度 |
| `notes.html` | `/notes` | 我的摘录三栏工作台 |
| `settings.html` | `/settings` | 设置：阅读偏好、主题、数据 |

## explorations —— 方向探索（已定稿，留档备查）

| 文件 | 结论 |
|---|---|
| `palettes.html` | 四套主题配色研究 → 落地为 paper / blue / night / violet |
| `2026-direction.html` | 2026 暗色「阅读 OS」方向 → 落地为 graphite 墨夜主题 |
| `loading-preview.html` | 首屏 loading 方向稿（Direction 03）→ 波形动画被采用 |
| `reading-entry-07.html` | 入场波形变体 07 → LoadingScreen 直接参考（见 `src/components/LoadingScreen.tsx`） |
| `reading-entry-variants.html` | 入场卡片变体探索 |
| `reading-entry-more.html` | 入场卡片变体探索（第二批） |

## 其他

- `magicui-notes.md` —— Magic UI 视觉语言的落地备注（用 CSS 复刻，不引依赖）

> 已移除：`index.html` 与 `home-backup.html`（二者逐字节相同，且为被
> `pages/app.html` 取代的旧版首页）。需要时可用
> `git log --all --oneline -- design/index.html` 从历史提交找回。
