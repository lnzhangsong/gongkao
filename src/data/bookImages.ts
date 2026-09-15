/**
 * 《申论写作八讲》书内图示索引：图片文件在 data/shenlun-book/images/（webp，
 * scripts/parse-shenlun-book.py 从 EPUB 扫描图转出），DB 里以 `images/l04-01.webp`
 * 这类相对路径引用。与行测题图同模式：import.meta.glob 进构建产物，<img loading=lazy>
 * 按需加载，不占首屏。缺失时返回 null（调用方渲染占位，不白图）。
 */
const modules = import.meta.glob<{ default: string }>('../../data/shenlun-book/images/*.webp', {
  eager: true,
})

const map = new Map<string, string>()
for (const [file, mod] of Object.entries(modules)) {
  const m = file.match(/images\/([^/]+\.webp)$/)
  if (m) map.set(m[1], mod.default)
}

/** DB 图片引用（images/xxx.webp）→ 打包后的资源 URL；未收录返回 null */
export function bookImage(src: string): string | null {
  return map.get(src.replace(/^images\//, '')) ?? null
}
