// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { downloadJSON, downloadText, formatDateTime, formatTimeOnly, monthOf } from './export'

/**
 * 导出工具：时间格式化 + 触发浏览器下载。
 * 时间函数读本地时区字段，故用「本地时间构造 → 再格式化」的方式断言，跨时区稳定。
 */

const localIso = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe('时间格式化', () => {
  it('formatDateTime：年月日 + 时分，个位补零', () => {
    expect(formatDateTime(localIso(2026, 6, 1, 9, 5))).toBe('2026.06.01　09:05')
    expect(formatDateTime(localIso(2026, 12, 31, 23, 59))).toBe('2026.12.31　23:59')
  })

  it('formatTimeOnly：只到日', () => {
    expect(formatTimeOnly(localIso(2026, 6, 1, 9, 5))).toBe('2026.06.01')
  })

  it('monthOf：中文年月分组标签', () => {
    expect(monthOf(localIso(2026, 6, 1, 9, 5))).toBe('2026 年 06 月')
    expect(monthOf(localIso(2026, 1, 15))).toBe('2026 年 01 月')
  })
})

describe('下载触发', () => {
  /* 用属性描述符保存/还原，避免「引用未绑定的方法」告警，也能正确处理原本不存在的属性 */
  const origCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const origRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const origClick = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'click')
  const clicked: string[] = []

  function restore(target: object, key: string, desc: PropertyDescriptor | undefined) {
    if (desc) Object.defineProperty(target, key, desc)
    else delete (target as Record<string, unknown>)[key]
  }

  afterEach(() => {
    restore(URL, 'createObjectURL', origCreate)
    restore(URL, 'revokeObjectURL', origRevoke)
    restore(HTMLAnchorElement.prototype, 'click', origClick)
    clicked.length = 0
  })

  function stubDownload() {
    URL.createObjectURL = () => 'blob:fake'
    URL.revokeObjectURL = () => {}
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    }
  }

  it('downloadJSON 以给定文件名触发下载，且不残留节点', () => {
    stubDownload()
    downloadJSON('readbook-export.json', { a: 1 })

    expect(clicked).toEqual(['readbook-export.json'])
    expect(document.querySelectorAll('a')).toHaveLength(0)
  })

  it('downloadText 同样触发下载', () => {
    stubDownload()
    downloadText('素材合集.md', '# 标题')

    expect(clicked).toEqual(['素材合集.md'])
    expect(document.querySelectorAll('a')).toHaveLength(0)
  })
})
