import { useEffect, useState } from 'react'
import type { GuiFanTerm } from '../../lib/api'
import { useReaderStore } from '../../stores/readerStore'

/**
 * 阅读页规范词标注：把正文里出现的规范词用方框圈出来（title 提示所属主题）。
 * 词库从 /api/terms 拉一次全量、模块级缓存；拉取失败时静默降级为不标注。
 * 匹配策略：首字索引 + 同起点最长匹配（词库按长度降序），单段线性扫描。
 */

let cache: GuiFanTerm[] | null = null
let pending: Promise<GuiFanTerm[]> | null = null

export function useGuifanTerms(): GuiFanTerm[] | null {
  const [terms, setTerms] = useState<GuiFanTerm[] | null>(cache)
  useEffect(() => {
    if (cache) return
    if (!pending) {
      pending = fetch('/api/terms', { cache: 'force-cache' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { terms: GuiFanTerm[] }) => {
          cache = d.terms
          return cache
        })
        .catch(() => {
          cache = []
          return cache
        })
    }
    void pending.then(setTerms)
  }, [])
  return terms && terms.length > 0 ? terms : null
}

/* 阅读标注只收 3 字以上：企业/规范/创新这类 2 字泛词字面太通用，圈出来全是噪音 */
const MIN_TERM_LEN = 3

/** 划词查重：该文本是否已在词库（缓存未就绪时返回 null = 未知） */
export function hasTermCached(text: string): boolean | null {
  if (!cache) return null
  return cache.some((t) => t.term === text)
}

export interface TermSegment {
  text: string
  /** 命中的规范词（含主题），未命中为 undefined */
  hit?: GuiFanTerm
}

/** 首字 → 该字开头的词（长词在前，保证同起点最长匹配） */
function buildIndex(terms: GuiFanTerm[]): Map<string, GuiFanTerm[]> {
  const idx = new Map<string, GuiFanTerm[]>()
  for (const t of terms) {
    const c = t.term[0]
    if (!c || t.term.length < MIN_TERM_LEN) continue
    const list = idx.get(c)
    if (list) list.push(t)
    else idx.set(c, [t])
  }
  for (const list of idx.values()) list.sort((a, b) => b.term.length - a.term.length)
  return idx
}

let indexCache: { terms: GuiFanTerm[]; idx: Map<string, GuiFanTerm[]> } | null = null
function getIndex(terms: GuiFanTerm[]) {
  if (!indexCache || indexCache.terms !== terms) indexCache = { terms, idx: buildIndex(terms) }
  return indexCache.idx
}

export function splitTermSegments(text: string, terms: GuiFanTerm[]): TermSegment[] {
  const idx = getIndex(terms)
  const out: TermSegment[] = []
  let plain = ''
  let i = 0
  const flush = () => {
    if (plain) {
      out.push({ text: plain })
      plain = ''
    }
  }
  while (i < text.length) {
    const candidates = idx.get(text[i])
    let matched: GuiFanTerm | undefined
    if (candidates) {
      for (const t of candidates) {
        if (text.startsWith(t.term, i)) {
          matched = t
          break
        }
      }
    }
    if (matched) {
      flush()
      out.push({ text: text.slice(i, i + matched.term.length), hit: matched })
      i += matched.term.length
    } else {
      plain += text[i]
      i++
    }
  }
  flush()
  return out
}

/** 段落文本 → 规范词方框标注的 React 节点（词库未就绪或开关关闭时原样返回） */
export function TermText({ text }: { text: string }) {
  const terms = useGuifanTerms()
  const termBox = useReaderStore((s) => s.settings.termBox)
  if (!terms || !termBox) return <>{text}</>
  return (
    <>
      {splitTermSegments(text, terms).map((seg, i) =>
        seg.hit ? (
          <span
            key={i}
            className="term-box"
            title={`规范词 · ${seg.hit.theme}`}
          >
            {seg.text}
          </span>
        ) : (
          <Fragmentish key={i} text={seg.text} />
        ),
      )}
    </>
  )
}

function Fragmentish({ text }: { text: string }) {
  return <>{text}</>
}
