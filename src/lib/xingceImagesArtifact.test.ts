import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

/**
 * 图片资产守卫：`data/xingce-img/` 是**行测图片的唯一来源，不是派生物**。
 *
 * 2026-09-13 起 JSON 只存轻量引用 `[{file,w,h}]`，图片字节不再内嵌 base64；而图片只能由
 * 裁图脚本从**仓库外的真题 PDF** 重裁。所以在没有源 PDF 的环境（别人 clone、CI）里，
 * git 里的这些 webp 一旦丢失就永久找不回——它长得像构建产物，其实不是。
 *
 * 断言每个引用都指向 (a) 存在的文件、(b) 已被 git 跟踪的文件。能挡住：
 * 删图、把目录加进 .gitignore、忘了 `git add`、引用写错文件名、又回到 base64 内嵌。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const JSON_DIR = path.join(ROOT, 'data', 'xingce')
const IMG_DIR = path.join(ROOT, 'data', 'xingce-img')

type Ref = { paperId: string; idx: number; file: string }
type Paper = { id: string; questions?: { idx: number; image?: unknown; groupImage?: unknown }[] }

function loadPapers(): Paper[] {
  return readdirSync(JSON_DIR)
    .filter((f) => f.startsWith('guokao-xingce-') && f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(JSON_DIR, f), 'utf8')) as Paper)
}

function collectRefs(papers: Paper[]): Ref[] {
  const out: Ref[] = []
  for (const paper of papers) {
    for (const q of paper.questions ?? []) {
      for (const [field, value] of [
        ['image', q.image],
        ['groupImage', q.groupImage],
      ] as const) {
        if (value == null) continue
        expect(Array.isArray(value), `${paper.id} 题${q.idx} 的 ${field} 必须是引用数组（不是 base64 字符串）`).toBe(
          true,
        )
        for (const it of value as { file?: string; w?: unknown; h?: unknown }[]) {
          expect(typeof it?.file, `${paper.id} 题${q.idx} 的 ${field} 条目缺 file`).toBe('string')
          // 尺寸供 <img> 预留布局，必须是正整数（0/负数/小数都会把布局算崩）
          for (const dim of ['w', 'h'] as const) {
            const v = it?.[dim]
            if (v !== undefined) {
              expect(
                typeof v === 'number' && Number.isInteger(v) && v > 0,
                `${paper.id} 题${q.idx} 的 ${field} 条目 ${dim}=${JSON.stringify(v) ?? 'undefined'} 必须是正整数`,
              ).toBe(true)
            }
          }
          out.push({ paperId: paper.id, idx: q.idx, file: it.file as string })
        }
      }
    }
  }
  return out
}

/** `data/xingce-img/` 下已被 git 跟踪的文件（相对 IMG_DIR 的路径）；拿不到 git 时返回 null */
function trackedImageFiles(): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', 'data/xingce-img'], { cwd: ROOT, encoding: 'utf8' })
    return new Set(
      out
        .split('\0')
        .filter(Boolean)
        .map((p) => path.relative('data/xingce-img', p)),
    )
  } catch {
    return null
  }
}

const papers = loadPapers()
const refs = collectRefs(papers)
const tracked = trackedImageFiles()

describe('data/xingce-img 作为图片资产', () => {
  it('至少解析出引用（守卫本身没走空）', () => {
    expect(papers.length).toBeGreaterThan(0)
    expect(refs.length).toBeGreaterThan(0)
  })

  it('每个引用都能在磁盘上找到对应文件', () => {
    const missing = refs
      .filter((r) => !existsSync(path.join(IMG_DIR, r.paperId, r.file)))
      .map((r) => `${r.paperId}/${r.file}`)
    expect(missing).toEqual([])
  })

  it.skipIf(tracked === null)('每个引用的图片都已被 git 跟踪（删图/ignore/漏 add 都会红）', () => {
    const untracked = refs.filter((r) => !tracked!.has(`${r.paperId}/${r.file}`)).map((r) => `${r.paperId}/${r.file}`)
    expect(untracked).toEqual([])
  })

  it('data/xingce-img 下没有未被引用的孤儿图片', () => {
    const referenced = new Set(refs.map((r) => `${r.paperId}/${r.file}`))
    const orphans: string[] = []
    for (const dir of readdirSync(IMG_DIR, { withFileTypes: true })) {
      // macOS 的 Finder 点一下就会生成 .DS_Store，跳过散落文件而非 ENOTDIR 崩掉
      if (!dir.isDirectory()) continue
      const full = path.join(IMG_DIR, dir.name)
      for (const f of readdirSync(full)) {
        if (!referenced.has(`${dir.name}/${f}`)) orphans.push(`${dir.name}/${f}`)
      }
    }
    expect(orphans).toEqual([])
  })

  it('同一题的引用不重复（历史上出现过图片重复渲染）', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const r of refs) {
      const key = `${r.paperId}/${r.idx}/${r.file}`
      if (seen.has(key)) dupes.push(key)
      seen.add(key)
    }
    expect(dupes).toEqual([])
  })
})
