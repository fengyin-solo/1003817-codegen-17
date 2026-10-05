import { listRows, refreshRows, saveRows } from '@/data/local-store'
import {
  PENDING_ARTIFACT_STATUS,
  SHELF_STATUS,
  applyClear,
  applySeal,
  applyStore,
  applyTidy,
  applyUnseal,
  groupByWarehouse,
  isFull,
  normalizeShelves,
} from '@/data/storage-ops'
import type { StorageOpResult, WarehouseCapacityGroup } from '@/data/storage-ops'
import type { ActionResult, EntryRow } from '@/data/types'

// 库房管理专用服务：容量视图、待入藏/已满/封存分栏、存放/封存/清理的读写编排。
// 业务判断本身在 data/storage-ops.ts，这里只负责刷新缓存与落库。
const STORAGE_MODULE = 'storage'
const ARTIFACT_MODULE = 'artifact'

function loadShelves(): EntryRow[] {
  const { rows, changed } = normalizeShelves(listRows(STORAGE_MODULE))
  if (changed) {
    // 历史架位回填后立即落库，迁移只发生一次。
    saveRows(STORAGE_MODULE, rows)
  }
  return rows
}

export type StorageOverview = {
  shelves: EntryRow[]
  groups: WarehouseCapacityGroup[]
  pendingArtifacts: EntryRow[]
  fullShelves: EntryRow[]
  sealedShelves: EntryRow[]
}

export function loadStorageOverview(): StorageOverview {
  refreshRows()
  const shelves = loadShelves()
  const artifacts = listRows(ARTIFACT_MODULE)
  return {
    shelves,
    groups: groupByWarehouse(shelves),
    pendingArtifacts: artifacts.filter((row) => String(row.status) === PENDING_ARTIFACT_STATUS),
    fullShelves: shelves.filter(isFull),
    sealedShelves: shelves.filter((row) => String(row.status) === SHELF_STATUS.sealed),
  }
}

function commit(result: StorageOpResult): ActionResult {
  if (!result.ok) {
    return { ok: false, message: result.message }
  }
  saveRows(STORAGE_MODULE, result.shelves)
  saveRows(ARTIFACT_MODULE, result.artifacts)
  return { ok: true, message: result.message }
}

/**
 * 办理存放：提交前重读 localStorage，拿到别处的最新写入；
 * expectedVersion 与架位当前版本不符时，说明已被另一笔申请抢先，明确失败。
 */
export function storeArtifacts(shelfId: number, artifactIds: number[], expectedVersion: number): ActionResult {
  refreshRows()
  return commit(applyStore(loadShelves(), listRows(ARTIFACT_MODULE), shelfId, artifactIds, expectedVersion))
}

export function sealShelf(shelfId: number): ActionResult {
  refreshRows()
  return commit(applySeal(loadShelves(), listRows(ARTIFACT_MODULE), shelfId))
}

export function unsealShelf(shelfId: number): ActionResult {
  refreshRows()
  return commit(applyUnseal(loadShelves(), listRows(ARTIFACT_MODULE), shelfId))
}

export function clearShelf(shelfId: number): ActionResult {
  refreshRows()
  return commit(applyClear(loadShelves(), listRows(ARTIFACT_MODULE), shelfId))
}

export function tidyShelf(shelfId: number): ActionResult {
  refreshRows()
  return commit(applyTidy(loadShelves(), listRows(ARTIFACT_MODULE), shelfId))
}
