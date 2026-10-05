/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 存放申请：多批遗物可能同时申请同一架位，办理时按乐观锁逐笔判定。 */
export type StorageApplication = {
  id: number
  batchName: string
  shelfId: number
  artifactIds: number[]
  /** 提交申请时看到的架位版本；办理时与当前版本不一致则明确失败。 */
  expectedVersion: number
  createdAt: string
  note: string
}

export type ApplicationOutcome = {
  ok: boolean
  applicationId: number
  batchName: string
  shelfCode: string
  placed: number
  message: string
}

export type CapacityRow = {
  shelf: EntryRow
  capacity: number
  current: number
  remain: number
  layers: number
  backfilled: boolean
  occupancy: number
  column: 'pending' | 'full' | 'sealed'
  heldArtifactCount: number
}

/** 库位容量视图：按库房 → 架位层数分组，行内带器物类别与容量三件套。 */
export type CapacityGroup = {
  warehouse: string
  layers: number
  rows: CapacityRow[]
  capacityTotal: number
  currentTotal: number
  remainTotal: number
}

export type CapacityBoard = {
  warehouses: string[]
  groups: CapacityGroup[]
  rows: CapacityRow[]
  pending: CapacityRow[]
  full: CapacityRow[]
  sealed: CapacityRow[]
  totalCapacity: number
  totalCurrent: number
  totalRemain: number
}

