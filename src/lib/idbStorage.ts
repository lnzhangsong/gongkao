import type { StateStorage } from 'zustand/middleware'

/**
 * IndexedDB 存储适配器（zustand persist storage）。
 *
 * 为什么用 IndexedDB：localStorage 上限约 5MB，只能容纳约两千篇完整文章；
 * 上万篇文章（约 25MB）必须使用配额更大的 IndexedDB（浏览器通常给到 GB 级）。
 *
 * 首次启动时自动把旧 localStorage 数据迁移过来（getItem 兜底），迁移后删除旧键。
 */

const DB_NAME = 'readbook-db'
const STORE = 'kv'
const DB_VERSION = 1

/** 复用数据库连接（避免每次操作都新建连接） */
let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/**
 * 按 key 串行化写入：IndexedDB 每次 put 是独立事务，
 * 多个异步写可能乱序提交（旧状态后写覆盖新状态），
 * 串行队列保证「最后一次写 = 最新状态」。
 */
const writeQueues = new Map<string, Promise<void>>()

function serializeWrite(key: string, task: () => Promise<void>): Promise<void> {
  const prev = (writeQueues.get(key) ?? Promise.resolve()).catch(() => {})
  const next = prev.then(task)
  writeQueues.set(key, next.catch(() => {}))
  return next
}

function idbGet(key: string): Promise<string | null> {
  return openDB().then(
    (db) =>
      new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(key)
        req.onsuccess = () => resolve((req.result as string | undefined) ?? null)
        req.onerror = () => reject(req.error)
      }),
  )
}

function idbSet(key: string, value: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

function idbDel(key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

/** 从旧 localStorage 迁移（拷贝到 IDB 后删除旧键） */
function migrateFromLocalStorage(key: string, value: string) {
  serializeWrite(key, () => idbSet(key, value))
    .then(() => {
      try {
        localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    })
    .catch(() => {
      /* 迁移失败不阻断：下次启动再试 */
    })
}

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const v = await idbGet(name)
      if (v !== null) return v
    } catch {
      /* 落到 localStorage 兜底 */
    }
    try {
      const legacy = localStorage.getItem(name)
      if (legacy !== null) {
        migrateFromLocalStorage(name, legacy)
        return legacy
      }
    } catch {
      /* ignore */
    }
    return null
  },
  setItem: (name, value) =>
    serializeWrite(name, () => idbSet(name, value)).catch(() => {}),
  removeItem: async (name) => {
    try {
      await idbDel(name)
    } catch {
      /* ignore */
    }
  },
}
