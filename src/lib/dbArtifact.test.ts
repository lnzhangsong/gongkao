import { closeSync, openSync, readSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

/**
 * 部署产物守卫：`data/articles.db` 必须能在一个**只读文件系统**上以只读方式打开。
 *
 * 真实事故：线上 `/api/exams` 报 `unable to open database file`（SQLITE_CANTOPEN，errcode 14）。
 * 根因是 Vercel 的函数目录只读，而 SQLite 的 **WAL 模式**即使以 `readOnly: true` 打开，
 * 也要创建 `-wal` / `-shm` 旁路文件——只读盘上直接失败。当时是导入脚本里的
 * `PRAGMA journal_mode = WAL` 把 WAL 标志写进了文件头，随 `articles.db` 一起提交部署。
 *
 * 这里直接读文件头第 18/19 字节，不依赖运行环境的目录权限，也不受 -wal/-shm 是否存在影响：
 * SQLite 规范里 2 = WAL、1 = 回滚日志（DELETE）。库一旦被改回 WAL，这个用例立刻红。
 */
const DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/articles.db')

function readHeader(): Buffer {
  const fd = openSync(DB, 'r')
  try {
    const buf = Buffer.alloc(24)
    readSync(fd, buf, 0, 24, 0)
    return buf
  } finally {
    closeSync(fd)
  }
}

describe('data/articles.db 作为部署产物', () => {
  it('处于回滚日志模式（非 WAL），可在只读函数目录打开', () => {
    const header = readHeader()
    expect(header.toString('latin1', 0, 15)).toBe('SQLite format 3')
    expect({ writeVersion: header[18], readVersion: header[19] }).toEqual({ writeVersion: 1, readVersion: 1 })
  })

  it('以 readOnly 打开时可读到真题三表', () => {
    const db = new DatabaseSync(DB, { readOnly: true })
    try {
      const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c
      expect(count('SELECT COUNT(*) c FROM papers')).toBeGreaterThan(0)
      expect(count('SELECT COUNT(*) c FROM materials')).toBeGreaterThan(0)
      expect(count('SELECT COUNT(*) c FROM questions')).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })
})
