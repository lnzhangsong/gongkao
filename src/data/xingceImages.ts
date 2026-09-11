import { XINGCE_IMAGE_DIMS } from './xingceImageDims.generated'

/**
 * 行测题图/材料图索引：图片文件在 data/xingce-img/{paper_id}/（scripts/import-xingce.mjs 落盘），
 * 经 import.meta.glob 打进前端构建——部署产物自带图片，不依赖静态目录或 api 路由。
 *
 * 文件名约定：q{题号}_N.webp = 题图；g{组号}_N.webp = 题组材料（_N 为多图序号）。
 * 查询返回 DataUrls 组件可用的 JSON 数组字符串（含 w/h 供 <img> 预留布局），无图返回 null。
 */
const modules = import.meta.glob('../../data/xingce-img/**/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** key = '{paper_id}/q{题号}' 或 '{paper_id}/g{组号}' → 组内图片按序号排列的条目列表 */
const parts: Record<string, { seq: number; item: { src: string; w?: number; h?: number } }[]> = {}
for (const [file, url] of Object.entries(modules)) {
  const m = file.match(/xingce-img\/([^/]+)\/([qg]\d+)(?:_(\d+))?\.webp$/)
  if (!m) continue
  const dim = XINGCE_IMAGE_DIMS[`${m[1]}/${m[2]}_${m[3] ?? 0}`]
  const item = { src: url, ...(dim ? { w: dim.w, h: dim.h } : {}) }
  const key = `${decodeURIComponent(m[1])}/${m[2]}`
  parts[key] = [...(parts[key] ?? []), { seq: Number(m[3] ?? 0), item }]
}

const byKey: Record<string, string> = {}
for (const [key, list] of Object.entries(parts)) {
  byKey[key] = JSON.stringify(list.sort((a, b) => a.seq - b.seq).map((p) => p.item))
}

/** 题图（q{idx}），无图返回 null */
export function xingceQuestionImage(paperId: string, idx: number): string | null {
  return byKey[`${paperId}/q${idx}`] ?? null
}

/** 题组材料图（g{groupId}），无组号或无图返回 null */
export function xingceGroupImage(paperId: string, groupId: number | null | undefined): string | null {
  return groupId == null ? null : (byKey[`${paperId}/g${groupId}`] ?? null)
}
