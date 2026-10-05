import type { EntryRow } from './types'

// 库房架位的纯业务规则：只操作传入的数组，不碰 localStorage，方便独立验证；
// 读写编排（刷新缓存、落库）在 api/storage-service.ts。

// 历史架位回填口径（老数据缺字段或字段不是数字时）：
// - 架位层数：缺失 / 不是正整数 → 按单层架回填为 1 层；
// - 容纳件数：缺失 / 不是正整数 → 按每层 20 件 × 回填后的层数回填；
// - 当前件数：缺失 / 负数 → 回填为 0；
// - 数据版本号 version：缺失 → 置 1（用于入藏申请的乐观并发控制）。
export const DEFAULT_LAYERS = 1
export const CAPACITY_PER_LAYER = 20

export const SHELF_STATUS = {
  normal: '正常使用',
  full: '已满',
  tidy: '待整理',
  sealed: '临时封存',
} as const

// 待入藏口径：出土遗物走完「已编号」、还没「已入库」的器物。
export const PENDING_ARTIFACT_STATUS = '已编号'
export const STORED_ARTIFACT_STATUS = '已入库'

function toPositiveInt(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isInteger(num) || num < 1) {
    return null
  }
  return num
}

function toNonNegativeInt(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isInteger(num) || num < 0) {
    return null
  }
  return num
}

/** 历史架位回填：返回（可能）规范化后的数组；changed 为 true 时调用方应落库。 */
export function normalizeShelves(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  let changed = false
  const next = rows.map((row) => {
    const layers = toPositiveInt(row['架位层数']) ?? DEFAULT_LAYERS
    const capacity = toPositiveInt(row['容纳件数']) ?? layers * CAPACITY_PER_LAYER
    const current = toNonNegativeInt(row['当前件数']) ?? 0
    const version = toPositiveInt(row['version']) ?? 1
    if (
      layers === row['架位层数'] &&
      capacity === row['容纳件数'] &&
      current === row['当前件数'] &&
      version === row['version']
    ) {
      return row
    }
    changed = true
    return {
      ...row,
      架位层数: layers,
      容纳件数: capacity,
      当前件数: current,
      version,
      // 历史脏数据（在库数超过容纳数）不擅自截断，标异常交给看板提示。
      abnormal: Boolean(row.abnormal) || current > capacity,
    }
  })
  return { rows: changed ? next : rows, changed }
}

export function remainingOf(row: EntryRow): number {
  return Math.max(0, Number(row['容纳件数']) - Number(row['当前件数']))
}

export function isFull(row: EntryRow): boolean {
  return Number(row['当前件数']) >= Number(row['容纳件数'])
}

export type ShelfCapacityView = {
  id: number
  code: string
  warehouse: string
  category: string
  layers: number
  capacity: number
  current: number
  remaining: number
  status: string
}

export type WarehouseCapacityGroup = {
  warehouse: string
  capacity: number
  current: number
  remaining: number
  shelves: ShelfCapacityView[]
}

/** 库位容量视图：按库房分组，架位带层数与器物类别，汇总容纳 / 当前 / 剩余。 */
export function groupByWarehouse(rows: EntryRow[]): WarehouseCapacityGroup[] {
  const groups = new Map<string, WarehouseCapacityGroup>()
  for (const row of rows) {
    const warehouse = String(row['库房名称'] ?? '未分库房')
    let group = groups.get(warehouse)
    if (!group) {
      group = { warehouse, capacity: 0, current: 0, remaining: 0, shelves: [] }
      groups.set(warehouse, group)
    }
    const capacity = Number(row['容纳件数'])
    const current = Number(row['当前件数'])
    const remaining = remainingOf(row)
    group.capacity += capacity
    group.current += current
    group.remaining += remaining
    group.shelves.push({
      id: Number(row.id),
      code: String(row['架位编号']),
      warehouse,
      category: String(row['存放器物类别']),
      layers: Number(row['架位层数']),
      capacity,
      current,
      remaining,
      status: String(row.status),
    })
  }
  const result = [...groups.values()]
  result.sort((a, b) => a.warehouse.localeCompare(b.warehouse, 'zh-Hans-CN'))
  for (const group of result) {
    group.shelves.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
  }
  return result
}

export type StorageOpResult =
  | { ok: true; message: string; shelves: EntryRow[]; artifacts: EntryRow[] }
  | { ok: false; message: string }

function findShelf(shelves: EntryRow[], shelfId: number): { index: number; shelf: EntryRow } | null {
  const index = shelves.findIndex((row) => Number(row.id) === shelfId)
  return index < 0 ? null : { index, shelf: shelves[index] }
}

function linkedArtifacts(artifacts: EntryRow[], code: string): EntryRow[] {
  return artifacts.filter(
    (row) => String(row['架位编号'] ?? '') === code && String(row.status) === STORED_ARTIFACT_STATUS,
  )
}

/**
 * 办理存放：多批遗物同时申请同一架位时，只有版本号对得上的一笔能成功，
 * 后到的请求（版本过期、空间被占、器物已被处理）都明确失败。
 */
export function applyStore(
  shelves: EntryRow[],
  artifacts: EntryRow[],
  shelfId: number,
  artifactIds: number[],
  expectedVersion: number,
): StorageOpResult {
  const found = findShelf(shelves, shelfId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${shelfId} 的库房架位` }
  }
  const { index, shelf } = found
  const code = String(shelf['架位编号'])
  if (Number(shelf.version) !== expectedVersion) {
    return {
      ok: false,
      message: `架位 ${code} 刚被另一笔申请变更（当前为第 ${shelf.version} 版），本次入藏申请失败，请刷新后重新发起`,
    }
  }
  if (String(shelf.status) === SHELF_STATUS.sealed) {
    return { ok: false, message: `架位 ${code} 已临时封存，请先解除封存再办理存放` }
  }
  if (artifactIds.length === 0) {
    return { ok: false, message: '未选择要入藏的器物' }
  }
  const remaining = remainingOf(shelf)
  if (artifactIds.length > remaining) {
    return {
      ok: false,
      message: `架位 ${code} 仅剩 ${remaining} 件空间，本次申请入藏 ${artifactIds.length} 件，当前件数不能超过容纳件数，申请失败`,
    }
  }
  const category = String(shelf['存放器物类别'])
  const artifactIndex = new Map(artifacts.map((row, i) => [Number(row.id), i]))
  const picked = new Set<number>()
  for (const id of artifactIds) {
    const idx = artifactIndex.get(id)
    if (idx === undefined) {
      return { ok: false, message: `没有找到编号为 ${id} 的出土遗物` }
    }
    const artifact = artifacts[idx]
    const artifactCode = String(artifact['器物编号'])
    if (String(artifact.status) !== PENDING_ARTIFACT_STATUS) {
      return {
        ok: false,
        message: `器物 ${artifactCode} 当前状态为「${artifact.status}」，不在待入藏队列，可能已被其他批次处理，本次申请失败`,
      }
    }
    if (String(artifact['器物类型']) !== category) {
      return {
        ok: false,
        message: `器物 ${artifactCode} 类型为「${artifact['器物类型']}」，与架位 ${code} 的存放类别「${category}」不符，不能入藏`,
      }
    }
    picked.add(idx)
  }
  const current = Number(shelf['当前件数']) + artifactIds.length
  const capacity = Number(shelf['容纳件数'])
  const nextStatus = current >= capacity ? SHELF_STATUS.full : SHELF_STATUS.normal
  const nextShelves = shelves.map((row, i) =>
    i === index
      ? {
          ...row,
          当前件数: current,
          status: nextStatus,
          架位状态: nextStatus,
          version: Number(row.version) + 1,
          pending: true,
          abnormal: false,
        }
      : row,
  )
  const nextArtifacts = artifacts.map((row, i) =>
    picked.has(i)
      ? {
          ...row,
          status: STORED_ARTIFACT_STATUS,
          登记状态: '在库',
          架位编号: code,
          pending: true,
          abnormal: false,
        }
      : row,
  )
  return {
    ok: true,
    message: `已向架位 ${code} 入藏 ${artifactIds.length} 件，当前 ${current}/${capacity} 件`,
    shelves: nextShelves,
    artifacts: nextArtifacts,
  }
}

/** 临时封存：架位状态翻转，并把架上在库器物的登记状态回写为「临时封存」。 */
export function applySeal(shelves: EntryRow[], artifacts: EntryRow[], shelfId: number): StorageOpResult {
  const found = findShelf(shelves, shelfId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${shelfId} 的库房架位` }
  }
  const { index, shelf } = found
  const code = String(shelf['架位编号'])
  if (String(shelf.status) === SHELF_STATUS.sealed) {
    return { ok: false, message: `架位 ${code} 已经是「${SHELF_STATUS.sealed}」，不用重复操作` }
  }
  const linked = linkedArtifacts(artifacts, code)
  const linkedIds = new Set(linked.map((row) => Number(row.id)))
  const nextShelves = shelves.map((row, i) =>
    i === index
      ? {
          ...row,
          status: SHELF_STATUS.sealed,
          架位状态: SHELF_STATUS.sealed,
          version: Number(row.version) + 1,
          pending: false,
          abnormal: false,
        }
      : row,
  )
  const nextArtifacts = artifacts.map((row) =>
    linkedIds.has(Number(row.id)) ? { ...row, 登记状态: SHELF_STATUS.sealed } : row,
  )
  return {
    ok: true,
    message: `架位 ${code} 已临时封存，${linked.length} 件在库器物同步标记封存`,
    shelves: nextShelves,
    artifacts: nextArtifacts,
  }
}

/** 解除封存：架位按容量回到「正常使用 / 已满」，架上器物登记状态回写为「在库」。 */
export function applyUnseal(shelves: EntryRow[], artifacts: EntryRow[], shelfId: number): StorageOpResult {
  const found = findShelf(shelves, shelfId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${shelfId} 的库房架位` }
  }
  const { index, shelf } = found
  const code = String(shelf['架位编号'])
  if (String(shelf.status) !== SHELF_STATUS.sealed) {
    return { ok: false, message: `架位 ${code} 不在临时封存状态，无需解除` }
  }
  const nextStatus = isFull(shelf) ? SHELF_STATUS.full : SHELF_STATUS.normal
  const linked = linkedArtifacts(artifacts, code)
  const linkedIds = new Set(linked.map((row) => Number(row.id)))
  const nextShelves = shelves.map((row, i) =>
    i === index
      ? {
          ...row,
          status: nextStatus,
          架位状态: nextStatus,
          version: Number(row.version) + 1,
          pending: true,
          abnormal: false,
        }
      : row,
  )
  const nextArtifacts = artifacts.map((row) =>
    linkedIds.has(Number(row.id)) ? { ...row, 登记状态: '在库' } : row,
  )
  return {
    ok: true,
    message: `架位 ${code} 已解除封存，恢复「${nextStatus}」，${linked.length} 件器物恢复在库`,
    shelves: nextShelves,
    artifacts: nextArtifacts,
  }
}

/** 清理下架：架上器物全部退回待入藏队列（回写出土遗物清单），架位清零转待整理。 */
export function applyClear(shelves: EntryRow[], artifacts: EntryRow[], shelfId: number): StorageOpResult {
  const found = findShelf(shelves, shelfId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${shelfId} 的库房架位` }
  }
  const { index, shelf } = found
  const code = String(shelf['架位编号'])
  if (String(shelf.status) === SHELF_STATUS.sealed) {
    return { ok: false, message: `架位 ${code} 已临时封存，请先解除封存再清理` }
  }
  const linked = linkedArtifacts(artifacts, code)
  if (Number(shelf['当前件数']) <= 0 && linked.length === 0) {
    return { ok: false, message: `架位 ${code} 当前没有在库器物，无需清理` }
  }
  const linkedIds = new Set(linked.map((row) => Number(row.id)))
  const nextShelves = shelves.map((row, i) =>
    i === index
      ? {
          ...row,
          当前件数: 0,
          status: SHELF_STATUS.tidy,
          架位状态: SHELF_STATUS.tidy,
          version: Number(row.version) + 1,
          pending: true,
          abnormal: false,
        }
      : row,
  )
  const nextArtifacts = artifacts.map((row) =>
    linkedIds.has(Number(row.id))
      ? {
          ...row,
          status: PENDING_ARTIFACT_STATUS,
          登记状态: '待入藏',
          架位编号: '',
          pending: true,
          abnormal: false,
        }
      : row,
  )
  return {
    ok: true,
    message: `架位 ${code} 已清理，${linked.length} 件器物退回待入藏队列，架位转入待整理`,
    shelves: nextShelves,
    artifacts: nextArtifacts,
  }
}

/** 调整整理：纯状态流转，同样推进版本号，让进行中的入藏申请明确失败。 */
export function applyTidy(shelves: EntryRow[], artifacts: EntryRow[], shelfId: number): StorageOpResult {
  const found = findShelf(shelves, shelfId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${shelfId} 的库房架位` }
  }
  const { index, shelf } = found
  const code = String(shelf['架位编号'])
  if (String(shelf.status) === SHELF_STATUS.sealed) {
    return { ok: false, message: `架位 ${code} 已临时封存，请先解除封存再整理` }
  }
  if (String(shelf.status) === SHELF_STATUS.tidy) {
    return { ok: false, message: `架位 ${code} 已经是「${SHELF_STATUS.tidy}」，不用重复操作` }
  }
  const nextShelves = shelves.map((row, i) =>
    i === index
      ? {
          ...row,
          status: SHELF_STATUS.tidy,
          架位状态: SHELF_STATUS.tidy,
          version: Number(row.version) + 1,
          pending: true,
          abnormal: false,
        }
      : row,
  )
  return {
    ok: true,
    message: `架位 ${code} 已转入待整理`,
    shelves: nextShelves,
    artifacts,
  }
}
