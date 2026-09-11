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
  // 注意：Vercel 传入的 req.url 是相对路径（/xingce-img/…?path=…），new URL() 会抛 Invalid URL，
  // 所以手工拆查询串；文件相对路径由 vercel.json rewrite 以 ?path= 注入
  try {
    const query = req.url.split('?')[1] ?? ''
    const fromParam = new URLSearchParams(query).get('path')
    const rel = decodeURIComponent(fromParam ?? req.url.split('?')[0].replace(/^\/xingce-img\//, '')).replace(
      /^\/+/,
      '',
    )
    if (rel.includes('..') || !/\.(png|webp)$/.test(rel)) {
      return new Response('Not Found', { status: 404 })
    }
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
