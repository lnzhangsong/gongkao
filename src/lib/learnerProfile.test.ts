import { describe, expect, it } from 'vite-plus/test'
import { deriveStatus, hasStudyContent } from './learnerProfile'
import type { ArticleStudy } from '../stores/shenlunStore'

/**
 * 文章层学习状态的推导规则：
 * 有实质加工内容 → 学习中；用户钉住（pinned）则不再自动升降。
 */

function study(over: Partial<ArticleStudy> = {}): ArticleStudy {
  return {
    articleId: 'p1',
    status: 'new',
    mastery: 0,
    coreThesis: '',
    subTheses: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('hasStudyContent（是否存在实质加工内容）', () => {
  it('未拆解 / 全空 → false', () => {
    expect(hasStudyContent(undefined)).toBe(false)
    expect(hasStudyContent(study())).toBe(false)
    expect(hasStudyContent(study({ coreThesis: '   ', subTheses: ['', '  '] }))).toBe(false)
    expect(hasStudyContent(study({ paragraphSummaries: [{ paraIndex: 0, summary: ' ' }] }))).toBe(false)
    expect(hasStudyContent(study({ skeleton: { opening: ' ', bodyLayers: [''], transitions: [], closing: '' } }))).toBe(
      false,
    )
  })

  it('核心观点 / 分论点 / 段意 / 骨架任一有内容 → true', () => {
    expect(hasStudyContent(study({ coreThesis: '基层治理要下沉' }))).toBe(true)
    expect(hasStudyContent(study({ subTheses: ['', '分论点'] }))).toBe(true)
    expect(hasStudyContent(study({ paragraphSummaries: [{ paraIndex: 2, summary: '段意' }] }))).toBe(true)
    expect(hasStudyContent(study({ skeleton: { opening: '开门见山' } }))).toBe(true)
    expect(hasStudyContent(study({ skeleton: { closing: '收束' } }))).toBe(true)
    expect(hasStudyContent(study({ skeleton: { bodyLayers: ['第一层'] } }))).toBe(true)
    expect(hasStudyContent(study({ skeleton: { transitions: ['承上启下'] } }))).toBe(true)
  })
})

describe('deriveStatus（自动推进建议）', () => {
  it('未拆解 → null（维持现状）', () => {
    expect(deriveStatus(undefined)).toBeNull()
  })

  it('未学 + 有实质内容 → learning', () => {
    expect(deriveStatus(study({ status: 'new', coreThesis: '有内容' }))).toBe('learning')
  })

  it('未学但无内容 → null（不空升）', () => {
    expect(deriveStatus(study({ status: 'new' }))).toBeNull()
  })

  it('钉住的记录不自动升降', () => {
    expect(deriveStatus(study({ status: 'new', coreThesis: '有内容', pinned: true }))).toBeNull()
  })

  it('已是 learning / mastered → null（推导只负责 new → learning）', () => {
    expect(deriveStatus(study({ status: 'learning', coreThesis: '有内容' }))).toBeNull()
    expect(deriveStatus(study({ status: 'mastered', coreThesis: '有内容' }))).toBeNull()
  })
})
