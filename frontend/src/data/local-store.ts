import { SEED_ROWS } from './seed'
import { migrateRows } from './migrations'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  let base: Record<string, EntryRow[]>
  if (typeof window === 'undefined' || !window.localStorage) {
    base = clone(SEED_ROWS)
  } else {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      base = clone(SEED_ROWS)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(base))
    } else {
      try {
        const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
        base = { ...clone(SEED_ROWS), ...parsed }
      } catch {
        base = clone(SEED_ROWS)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(base))
      }
    }
  }
  // 规整历史架位（层数回填、件数对齐遗物清单），有改动时落盘一次。
  const migrated = migrateRows(base)
  if (migrated !== base && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
  }
  return migrated
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 联调/测试用：丢弃内存缓存，下次读取重新从 localStorage 迁移加载。 */
export function evictCache(): void {
  cache = null
}
