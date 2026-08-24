# design / 设计原型

静态 HTML 原型与方向探索稿。应用本体在 `src/`，这里是视觉验收的依据。

## pages —— 页面原型（已验收，与路由一一对应）

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
