/**
 * GET /xingce-img/:paper/:file — 行测题图/材料图（Vercel Function）
 *
 * 图片落盘在 data/xingce-img/（不进 public/），vercel.json rewrite 进本函数按需读取。
 * db（xg_questions.image/group_image）存的是 /xingce-img/… 路径数组，前端 <img src> 直取。
 * 自包含全部逻辑（不 import 兄弟模块）——Vercel 只打包入口文件（api/xingce.ts 同款约定）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const rel = decodeURIComponent(url.pathname.replace(/^\/xingce-img\//, ''))
  if (rel.includes('..') || !/\.(png|webp)$/.test(rel)) {
    return new Response('Not Found', { status: 404 })
  }
  try {
    const data = await fs.readFile(path.join(PROJECT_ROOT, 'data', 'xingce-img', rel))
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': rel.endsWith('.webp') ? 'image/webp' : 'image/png',
        'cache-control': 'public, max-age=3600',
      },
    })
  } catch {
    return new Response('Not Found', { status: 404 })
  }
}
