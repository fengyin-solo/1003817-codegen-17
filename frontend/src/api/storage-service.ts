import { listRows, saveRows } from '@/data/local-store'
import { positiveInt } from '@/data/migrations'
import type {
  ActionResult,
  ApplicationOutcome,
  CapacityBoard,
  CapacityGroup,
  CapacityRow,
  EntryRow,
  StorageApplication,
} from '@/data/types'

// 存放申请单独存一份：多批遗物可同时挂申请，办理时按提交时看到的架位版本做乐观锁判定。
const APP_STORAGE_KEY = 'field-archaeology-digital:storage-applications'
const READY_STATUS = '已编号'
const STORED_STATUS = '已入库'
const SEALED_ARTIFACT_STATUS = '封存中'

function shelves(): EntryRow[] {
  return listRows('storage')
}

function artifacts(): EntryRow[] {
  return listRows('artifact')
}

function findShelf(shelfId: number): EntryRow | undefined {
  return shelves().find((row) => Number(row.id) === shelfId)
}

function shelfCode(row: EntryRow): string {
  return String(row.架位编号 ?? `#${row.id}`)
}

/** 当前件数一律以「出土遗物清单里落在该架位的件数」为准。 */
export function heldCount(shelfCodeValue: string): number {
  return artifacts().filter((item) => String(item.所在架位 ?? '') === shelfCodeValue).length
}

export function shelfCapacity(row: EntryRow): number {
  return positiveInt(row.容纳件数, 0)
}

export function shelfLayers(row: EntryRow): number {
  return positiveInt(row.架位层数, 3)
}

export function isBackfilled(row: EntryRow): boolean {
  return row.层数回填 === true
}

function columnOf(row: EntryRow, current: number, capacity: number): CapacityRow['column'] {
  const status = String(row.status)
  if (status === '临时封存') {
    return 'sealed'
  }
  if (status === '已满' || (capacity > 0 && current >= capacity)) {
    return 'full'
  }
  return 'pending'
}

function toCapacityRow(row: EntryRow): CapacityRow {
  const capacity = shelfCapacity(row)
  const current = heldCount(shelfCode(row))
  const remain = Math.max(0, capacity - current)
  return {
    shelf: row,
    capacity,
    current,
    remain,
    layers: shelfLayers(row),
    backfilled: isBackfilled(row),
    occupancy: capacity > 0 ? Math.min(100, Math.round((current / capacity) * 100)) : 0,
    column: columnOf(row, current, capacity),
    heldArtifactCount: current,
  }
}

/** 库位容量视图：按库房 → 架位层数分组，行内带器物类别与容量三件套。 */
export function loadCapacity(filters: Record<string, string> = {}): CapacityBoard {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched = shelves().filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
  const rows = matched.map(toCapacityRow).sort((a, b) => {
    const byWarehouse = String(a.shelf.库房名称).localeCompare(String(b.shelf.库房名称))
    if (byWarehouse !== 0) {
      return byWarehouse
    }
    if (a.layers !== b.layers) {
      return a.layers - b.layers
    }
    const byCategory = String(a.shelf.存放器物类别).localeCompare(String(b.shelf.存放器物类别))
    return byCategory !== 0 ? byCategory : shelfCode(a.shelf).localeCompare(shelfCode(b.shelf))
  })

  const groupMap = new Map<string, CapacityGroup>()
  for (const row of rows) {
    const warehouse = String(row.shelf.库房名称 ?? '未命名库房')
    const key = `${warehouse}__${row.layers}`
    const group = groupMap.get(key) ?? {
      warehouse,
      layers: row.layers,
      rows: [],
      capacityTotal: 0,
      currentTotal: 0,
      remainTotal: 0,
    }
    group.rows.push(row)
    group.capacityTotal += row.capacity
    group.currentTotal += row.current
    group.remainTotal += row.remain
    groupMap.set(key, group)
  }

  const pending = rows.filter((row) => row.column === 'pending')
  const full = rows.filter((row) => row.column === 'full')
  const sealed = rows.filter((row) => row.column === 'sealed')

  return {
    warehouses: [...new Set(rows.map((row) => String(row.shelf.库房名称 ?? '未命名库房')))],
    groups: [...groupMap.values()],
    rows,
    pending,
    full,
    sealed,
    totalCapacity: rows.reduce((sum, row) => sum + row.capacity, 0),
    totalCurrent: rows.reduce((sum, row) => sum + row.current, 0),
    totalRemain: rows.reduce((sum, row) => sum + row.remain, 0),
  }
}

/** 待入藏遗物池：已经分到编号、尚未落在任何架位上的器物。 */
export function pendingArtifacts(): EntryRow[] {
  return artifacts()
    .filter((row) => String(row.status) === READY_STATUS && String(row.所在架位 ?? '') === '')
    .sort((a, b) => String(a.器物编号).localeCompare(String(b.器物编号)))
}

// ---- 存放申请（乐观锁） ----------------------------------------------------------------

function readApplications(): StorageApplication[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StorageApplication[]) : []
  } catch {
    return []
  }
}

function writeApplications(apps: StorageApplication[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(apps))
  }
}

export function listApplications(): StorageApplication[] {
  const shelfIdSet = new Set(shelves().map((row) => Number(row.id)))
  return readApplications()
    .filter((app) => shelfIdSet.has(app.shelfId))
    .sort((a, b) => a.id - b.id)
}

export function getShelfVersion(shelfId: number): number {
  const shelf = findShelf(shelfId)
  return shelf ? positiveInt(shelf.version, 1) : 0
}

export function submitApplication(input: {
  batchName: string
  shelfId: number
  artifactIds: number[]
  note?: string
}): ActionResult {
  const shelf = findShelf(input.shelfId)
  if (!shelf) {
    return { ok: false, message: '没有找到目标架位，请刷新容量视图后重试' }
  }
  const ids = [...new Set(input.artifactIds)]
  if (ids.length === 0) {
    return { ok: false, message: '请先勾选要入藏的遗物' }
  }
  const apps = readApplications()
  const nextId = apps.reduce((max, app) => Math.max(max, app.id), 0) + 1
  const batchName = input.batchName.trim() || `第 ${nextId} 批`
  apps.push({
    id: nextId,
    batchName,
    shelfId: input.shelfId,
    artifactIds: ids,
    expectedVersion: getShelfVersion(input.shelfId),
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    note: input.note ?? '',
  })
  writeApplications(apps)
  return { ok: true, message: `批次「${batchName}」已挂起，等待办理（${ids.length} 件 → ${shelfCode(shelf)}）` }
}

function removeApplication(appId: number): void {
  writeApplications(readApplications().filter((app) => app.id !== appId))
}

export function cancelApplication(appId: number): void {
  removeApplication(appId)
}

export function clearApplications(): void {
  writeApplications([])
}

/**
 * 核心入藏事务。expectedVersion 存在时做乐观锁校验：
 * 同一架位上先到的批次一旦提交，后到批次看到的版本即过期，必须明确失败。
 */
function commitIntake(
  shelf: EntryRow,
  artifactIds: number[],
  expectedVersion?: number,
): ActionResult {
  const code = shelfCode(shelf)
  const currentVersion = positiveInt(shelf.version, 1)
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    return {
      ok: false,
      message: `架位 ${code} 已被先到的批次办理（版本 ${expectedVersion} → ${currentVersion}），本笔申请失败，请重新查看容量后再次申请`,
    }
  }

  const status = String(shelf.status)
  if (status === '临时封存') {
    return { ok: false, message: `架位 ${code} 处于临时封存，不能办理存放` }
  }
  if (status === '已满') {
    return { ok: false, message: `架位 ${code} 已满，不能办理存放` }
  }

  const allArtifacts = artifacts()
  const byId = new Map(allArtifacts.map((item) => [Number(item.id), item]))
  const ids = [...new Set(artifactIds)]
  const invalid: string[] = []
  const targets: EntryRow[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) {
      invalid.push(`#${id}`)
      continue
    }
    const location = String(item.所在架位 ?? '')
    if (location !== '') {
      invalid.push(`${item.器物编号}（已在 ${location}）`)
      continue
    }
    if (String(item.status) !== READY_STATUS) {
      invalid.push(`${item.器物编号}（当前状态「${item.status}」，不在待入藏池）`)
      continue
    }
    targets.push(item)
  }
  if (invalid.length > 0) {
    return { ok: false, message: `部分遗物已不能入藏：${invalid.join('、')}` }
  }

  const capacity = shelfCapacity(shelf)
  const held = heldCount(code)
  if (held + targets.length > capacity) {
    const remain = Math.max(0, capacity - held)
    return {
      ok: false,
      message: `架位 ${code} 剩余空间仅 ${remain} 件，本批 ${targets.length} 件无法整批入藏（当前 ${held}/${capacity}）`,
    }
  }

  // 回写出土遗物清单：落架位、改入库状态。
  const nextArtifacts = allArtifacts.map((item) =>
    targets.some((target) => Number(target.id) === Number(item.id))
      ? { ...item, 所在架位: code, status: STORED_STATUS, 登记状态: STORED_STATUS, pending: false }
      : item,
  )
  saveRows('artifact', nextArtifacts)

  const nextHeld = held + targets.length
  const nextStatus: string = nextHeld >= capacity ? '已满' : '正常使用'
  const nextShelf: EntryRow = {
    ...shelf,
    当前件数: nextHeld,
    status: nextStatus,
    架位状态: nextStatus,
    pending: true,
    version: currentVersion + 1,
  }
  const nextShelves = shelves().map((row) => (Number(row.id) === Number(shelf.id) ? nextShelf : row))
  saveRows('storage', nextShelves)

  return {
    ok: true,
    message: `${targets.length} 件遗物已入藏 ${code}，架位件数 ${nextHeld}/${capacity}${
      nextStatus === '已满' ? '，架位已满' : `，剩余 ${capacity - nextHeld} 件`
    }`,
  }
}

/** 办理单笔存放申请；失败的申请保留在队列里，由经办人调整后重新提交。 */
export function processApplication(appId: number): ApplicationOutcome {
  const app = readApplications().find((item) => item.id === appId)
  const fallback: ApplicationOutcome = {
    ok: false,
    applicationId: appId,
    batchName: '未知批次',
    shelfCode: '—',
    placed: 0,
    message: '申请不存在或已被处理',
  }
  if (!app) {
    return fallback
  }
  const shelf = findShelf(app.shelfId)
  if (!shelf) {
    return { ...fallback, batchName: app.batchName, message: '目标架位已不存在，申请失败' }
  }
  const result = commitIntake(shelf, app.artifactIds, app.expectedVersion)
  const outcome: ApplicationOutcome = {
    ok: result.ok,
    applicationId: app.id,
    batchName: app.batchName,
    shelfCode: shelfCode(shelf),
    placed: result.ok ? app.artifactIds.length : 0,
    message: result.ok
      ? `批次「${app.batchName}」办理成功：${result.message}`
      : `批次「${app.batchName}」申请失败：${result.message}`,
  }
  if (result.ok) {
    removeApplication(app.id)
  }
  return outcome
}

/** 按提交先后逐笔办理全部申请：先到先得，后到者逐笔给出明确失败原因。 */
export function processAllApplications(): ApplicationOutcome[] {
  return listApplications().map((app) => processApplication(app.id))
}

/**
 * 多批遗物同时申请同一架位：基于同一视图版本挂起两笔申请并立即按先后办理，
 * 第一笔成功提交，第二笔因架位版本已前进而明确失败（失败申请保留在队列中）。
 */
export function simulateContention(
  shelfId: number,
  artifactIds: number[],
): { submitted: StorageApplication[]; outcomes: ApplicationOutcome[] } {
  const shelf = findShelf(shelfId)
  const version = shelf ? positiveInt(shelf.version, 1) : 1
  const apps = readApplications()
  let nextId = apps.reduce((max, app) => Math.max(max, app.id), 0) + 1
  const now = new Date().toLocaleString('zh-CN', { hour12: false })
  const payloadA: StorageApplication = {
    id: nextId,
    batchName: `并发演示·甲批`,
    shelfId,
    artifactIds: [...new Set(artifactIds)],
    expectedVersion: version,
    createdAt: now,
    note: '同一视图下与乙批同时提交',
  }
  const payloadB: StorageApplication = {
    id: nextId + 1,
    batchName: `并发演示·乙批`,
    shelfId,
    artifactIds: [...new Set(artifactIds)],
    expectedVersion: version,
    createdAt: now,
    note: '同一视图下与甲批同时提交，应明确失败',
  }
  apps.push(payloadA, payloadB)
  writeApplications(apps)
  const outcomes = [processApplication(payloadA.id), processApplication(payloadB.id)]
  return { submitted: [payloadA, payloadB], outcomes }
}

/** 不经申请队列直接办理（行内按钮）：容量约束照常生效。 */
export function placeDirect(shelfId: number, artifactIds: number[]): ActionResult {
  const shelf = findShelf(shelfId)
  if (!shelf) {
    return { ok: false, message: '没有找到目标架位' }
  }
  return commitIntake(shelf, artifactIds)
}

// ---- 临时封存 / 清理架位：都要实际回写出土遗物清单 ------------------------------------

/** 临时封存：架位置封存态，架上遗物清单同步改为「封存中」。 */
export function sealShelf(shelfId: number): ActionResult {
  const shelf = findShelf(shelfId)
  if (!shelf) {
    return { ok: false, message: '没有找到目标架位' }
  }
  const code = shelfCode(shelf)
  if (String(shelf.status) === '临时封存') {
    return { ok: false, message: `架位 ${code} 已经处于临时封存` }
  }
  const nextArtifacts = artifacts().map((item) =>
    String(item.所在架位 ?? '') === code
      ? { ...item, status: SEALED_ARTIFACT_STATUS, 登记状态: SEALED_ARTIFACT_STATUS, pending: false }
      : item,
  )
  saveRows('artifact', nextArtifacts)

  const nextShelf: EntryRow = {
    ...shelf,
    status: '临时封存',
    架位状态: '临时封存',
    pending: false,
    version: positiveInt(shelf.version, 1) + 1,
  }
  saveRows('storage', shelves().map((row) => (Number(row.id) === shelfId ? nextShelf : row)))
  const sealedCount = heldCount(code)
  return {
    ok: true,
    message: `架位 ${code} 已临时封存，清单内 ${sealedCount} 件遗物同步标记「封存中」`,
  }
}

/** 清理架位：架上遗物退回待入藏池，当前件数清零，架位转为待整理。 */
export function clearShelf(shelfId: number): ActionResult {
  const shelf = findShelf(shelfId)
  if (!shelf) {
    return { ok: false, message: '没有找到目标架位' }
  }
  const code = shelfCode(shelf)
  const held = heldCount(code)
  if (held === 0) {
    // 即便没有遗物，也允许把封存架整理回待整理。
    if (String(shelf.status) === '待整理') {
      return { ok: false, message: `架位 ${code} 已是待整理，没有需要清理的遗物` }
    }
  }
  const nextArtifacts = artifacts().map((item) =>
    String(item.所在架位 ?? '') === code
      ? {
          ...item,
          所在架位: '',
          status: READY_STATUS,
          登记状态: READY_STATUS,
          pending: true,
        }
      : item,
  )
  saveRows('artifact', nextArtifacts)

  const nextShelf: EntryRow = {
    ...shelf,
    当前件数: 0,
    status: '待整理',
    架位状态: '待整理',
    pending: true,
    version: positiveInt(shelf.version, 1) + 1,
  }
  saveRows('storage', shelves().map((row) => (Number(row.id) === shelfId ? nextShelf : row)))
  return {
    ok: true,
    message: `架位 ${code} 清理完成：${held} 件遗物已退回待入藏池，当前件数清零，架位转为待整理`,
  }
}
