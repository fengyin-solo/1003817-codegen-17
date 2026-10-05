import type { EntryRow } from './types'

// 历史架位层数回填口径：早期库房架位没有登记层数，统一按常规档案架 3 层回填，
// 并在记录上打「层数回填」标记，容量视图与清单里会明确标出，不与实测层数混淆。
export const LEGACY_DEFAULT_LAYERS = 3

export function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (Number.isInteger(n) && n > 0) {
    return n
  }
  return fallback
}

export function nonNegativeInt(value: unknown, fallback = 0): number {
  const n = Number(value)
  if (Number.isInteger(n) && n >= 0) {
    return n
  }
  return fallback
}

function countArtifactsOnShelf(all: Record<string, EntryRow[]>, shelfCode: string): number {
  return (all.artifact ?? []).filter((row) => String(row.所在架位 ?? '') === shelfCode).length
}

/**
 * 就地规整历史数据：
 * 1. 架位层数缺失/非正整数 → 按 3 层回填并标记「层数回填」；
 * 2. 容纳件数/当前件数不可解析时给出可用的整数口径；
 * 3. 当前件数以「出土遗物清单里落在该架位的件数」为准重算，保证两处始终对得上；
 * 4. 补乐观锁版本号；遗物清单补齐「所在架位」字段。
 * 返回新对象（有改动时）或原对象。
 */
export function migrateRows(all: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  let changed = false

  let artifacts = all.artifact ?? []
  if (artifacts.some((row) => row.所在架位 === undefined)) {
    artifacts = artifacts.map((row) => (row.所在架位 === undefined ? { ...row, 所在架位: '' } : row))
    changed = true
  }

  const shelves = (all.storage ?? []).map((row) => {
    const origin: EntryRow = row
    const next: EntryRow = { ...row }
    let rowChanged = false

    const layers = Number(next.架位层数)
    if (!(Number.isInteger(layers) && layers > 0)) {
      next.架位层数 = LEGACY_DEFAULT_LAYERS
      next.层数回填 = true
      rowChanged = true
    } else if (next.层数回填 === undefined) {
      next.层数回填 = false
      rowChanged = true
    }

    next.容纳件数 = nonNegativeInt(next.容纳件数, 0)
    const capacity = Number(next.容纳件数)
    const held = countArtifactsOnShelf({ ...all, artifact: artifacts }, String(next.架位编号))
    if (Number(next.当前件数) !== held) {
      next.当前件数 = held
      rowChanged = true
    }

    // 活动架位（未封存、未待整理）的「已满」按件数重算；封存/待整理是业务动作置的状态，不覆盖。
    const status = String(next.status)
    if (status !== '临时封存' && status !== '待整理') {
      if (capacity > 0 && held >= capacity && status !== '已满') {
        next.status = '已满'
        next.架位状态 = '已满'
        rowChanged = true
      } else if (held < capacity && status === '已满') {
        next.status = '正常使用'
        next.架位状态 = '正常使用'
        rowChanged = true
      }
    }
    if (String(next.架位状态 ?? '') !== String(next.status)) {
      next.架位状态 = next.status
      rowChanged = true
    }

    const version = Number(next.version)
    if (!(Number.isInteger(version) && version > 0)) {
      next.version = 1
      rowChanged = true
    }

    if (rowChanged) {
      changed = true
      return next
    }
    return origin
  })

  if (!changed) {
    return all
  }
  return { ...all, artifact: artifacts, storage: shelves }
}
