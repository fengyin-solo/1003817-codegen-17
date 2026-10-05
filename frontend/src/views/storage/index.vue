<template>
  <section class="page" data-module="storage">
    <header class="page-head">
      <div>
        <h2>库房管理 · 库位容量</h2>
        <p class="page-desc">
          按库房、架位层数与器物类别展示容纳件数、当前件数与剩余空间；待入藏、已满、临时封存分栏办理。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导岀库房清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>库房名称</span>
        <input v-model="filters.库房名称" placeholder="按库房名称检索" />
      </label>
      <label class="filter-item">
        <span>存放器物类别</span>
        <input v-model="filters.存放器物类别" placeholder="按器物类别检索" />
      </label>
      <label class="filter-item">
        <span>架位编号</span>
        <input v-model="filters.架位编号" placeholder="按架位编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3 class="section-title">库位容量视图（按库房 / 架位层数 / 器物类别）</h3>
    <div v-for="group in board.groups" :key="`${group.warehouse}-${group.layers}`" class="capacity-group">
      <header class="group-head">
        <strong>{{ group.warehouse }}</strong>
        <span class="group-meta">架位层数：{{ group.layers }} 层</span>
        <span class="group-meta">
          容纳 {{ group.capacityTotal }} · 当前 {{ group.currentTotal }} · 剩余 {{ group.remainTotal }}
        </span>
      </header>
      <table class="data-table capacity-table">
        <thead>
          <tr>
            <th>架位编号</th>
            <th>器物类别</th>
            <th>层数</th>
            <th>容纳件数</th>
            <th>当前件数</th>
            <th>剩余空间</th>
            <th>占用率</th>
            <th>管理人</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.rows" :key="String(row.shelf.id)">
            <td>{{ row.shelf.架位编号 }}</td>
            <td>{{ row.shelf.存放器物类别 }}</td>
            <td>
              {{ row.layers }}
              <span v-if="row.backfilled" class="tag tag-backfill" title="历史架位缺失层数字段，按常规档案架 3 层回填">层数回填</span>
            </td>
            <td>{{ row.capacity }}</td>
            <td>{{ row.current }}</td>
            <td>
              <span :class="['remain', { zero: row.remain === 0 }]">{{ row.remain }}</span>
            </td>
            <td>
              <div class="bar"><span :style="{ width: `${row.occupancy}%` }" :class="['bar-fill', row.column]" /></div>
              <span class="bar-text">{{ row.occupancy }}%</span>
            </td>
            <td>{{ row.shelf.管理人 }}</td>
            <td>
              <span :class="['status-pill', row.column]">{{ row.shelf.status }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!board.rows.length" class="empty-block">当前筛选条件下没有架位。</p>

    <h3 class="section-title">分区办理</h3>
    <div class="columns">
      <!-- 待入藏 -->
      <article class="lane lane-pending">
        <header class="lane-head">
          <h4>待入藏区域</h4>
          <span class="lane-count">{{ board.pending.length }} 个架位 · 池内 {{ pendingPool.length }} 件待入藏</span>
        </header>
        <ul v-if="board.pending.length" class="lane-list">
          <li v-for="row in board.pending" :key="String(row.shelf.id)" class="lane-item">
            <div class="lane-line">
              <span class="lane-code">{{ row.shelf.架位编号 }}</span>
              <span class="lane-dim">{{ row.shelf.存放器物类别 }} · {{ row.layers }} 层</span>
            </div>
            <div class="lane-line muted">
              {{ row.current }}/{{ row.capacity }} 件，剩余 {{ row.remain }}
              <span v-if="row.shelf.status === '待整理'" class="tag tag-warn">待整理</span>
            </div>
            <div class="lane-line actions">
              <button class="btn small primary" type="button" @click="openIntake(row.shelf.id)">办理存放</button>
              <button class="link" type="button" @click="runSeal(row.shelf.id)">临时封存</button>
              <button class="link danger" type="button" @click="runClear(row.shelf.id)">清理</button>
            </div>
          </li>
        </ul>
        <p v-else class="lane-empty">暂无可接收遗物的架位</p>
      </article>

      <!-- 已满 -->
      <article class="lane lane-full">
        <header class="lane-head">
          <h4>已满区域</h4>
          <span class="lane-count">{{ board.full.length }} 个架位</span>
        </header>
        <ul v-if="board.full.length" class="lane-list">
          <li v-for="row in board.full" :key="String(row.shelf.id)" class="lane-item">
            <div class="lane-line">
              <span class="lane-code">{{ row.shelf.架位编号 }}</span>
              <span class="lane-dim">{{ row.shelf.存放器物类别 }} · {{ row.layers }} 层</span>
            </div>
            <div class="lane-line muted">{{ row.current }}/{{ row.capacity }} 件，剩余 0</div>
            <div class="lane-line actions">
              <button class="btn small" type="button" disabled>存放已停用</button>
              <button class="link" type="button" @click="runSeal(row.shelf.id)">临时封存</button>
              <button class="link danger" type="button" @click="runClear(row.shelf.id)">清理</button>
            </div>
          </li>
        </ul>
        <p v-else class="lane-empty">暂无已满架位</p>
      </article>

      <!-- 临时封存 -->
      <article class="lane lane-sealed">
        <header class="lane-head">
          <h4>临时封存区域</h4>
          <span class="lane-count">{{ board.sealed.length }} 个架位</span>
        </header>
        <ul v-if="board.sealed.length" class="lane-list">
          <li v-for="row in board.sealed" :key="String(row.shelf.id)" class="lane-item">
            <div class="lane-line">
              <span class="lane-code">{{ row.shelf.架位编号 }}</span>
              <span class="lane-dim">{{ row.shelf.存放器物类别 }} · {{ row.layers }} 层</span>
            </div>
            <div class="lane-line muted">封存 {{ row.current }}/{{ row.capacity }} 件（清单同步「封存中」）</div>
            <div class="lane-line actions">
              <button class="btn small" type="button" disabled>存放已停用</button>
              <button class="link danger" type="button" @click="runClear(row.shelf.id)">清理并解除</button>
            </div>
          </li>
        </ul>
        <p v-else class="lane-empty">暂无封存架位</p>
      </article>
    </div>

    <!-- 存放申请队列 -->
    <section class="queue">
      <header class="queue-head">
        <h3 class="section-title">存放申请队列（多批遗物并发申请同一架位）</h3>
        <div class="queue-actions">
          <button class="btn small" type="button" :disabled="!applications.length" @click="processAll">
            按先后顺序逐笔办理（{{ applications.length }}）
          </button>
          <button class="btn ghost small" type="button" :disabled="!applications.length" @click="dropApplications">
            清空申请
          </button>
        </div>
      </header>
      <table v-if="applications.length" class="data-table">
        <thead>
          <tr>
            <th>批次</th>
            <th>目标架位</th>
            <th>申请件数</th>
            <th>提交时版本</th>
            <th>提交时间</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="app in applications" :key="app.id">
            <td>{{ app.batchName }}</td>
            <td>{{ shelfLabel(app.shelfId) }}</td>
            <td>{{ app.artifactIds.length }}</td>
            <td>v{{ app.expectedVersion }}</td>
            <td>{{ app.createdAt }}</td>
            <td class="muted">{{ app.note || '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="processOne(app.id)">办理此笔</button>
              <button class="link danger" type="button" @click="cancelOne(app.id)">撤销</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="lane-empty">当前没有挂起的存放申请。在「办理存放」弹窗里可提交申请，或一键模拟两批遗物同时争抢同一架位。</p>
    </section>

    <!-- 架位登记表（保留原始清单视角） -->
    <h3 class="section-title">架位登记清单</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in board.rows" :key="String(row.shelf.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '架位层数'">
              {{ row.layers }}
              <span v-if="row.backfilled" class="tag tag-backfill">回填</span>
            </template>
            <template v-else-if="column === '当前件数'">{{ row.current }}</template>
            <template v-else>{{ row.shelf[column] ?? '—' }}</template>
          </td>
          <td><span :class="['status-pill', row.column]">{{ row.shelf.status }}</span></td>
        </tr>
        <tr v-if="!board.rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无库房架位数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ board.rows.length }} 个架位 · 总容纳 {{ board.totalCapacity }} · 已占用 {{ board.totalCurrent }} ·
        总剩余 {{ board.totalRemain }}
      </span>
      <span v-if="message" :class="['flash', messageOk ? 'ok' : 'error-text']">{{ message }}</span>
    </footer>

    <!-- 办理存放弹窗 -->
    <div v-if="intake.open" class="modal-mask" @click.self="closeIntake">
      <div class="modal">
        <header class="modal-head">
          <h4>办理存放 → {{ intakeTarget?.架位编号 }}</h4>
          <button class="link" type="button" @click="closeIntake">关闭</button>
        </header>
        <div v-if="intakeTarget" class="modal-body">
          <p class="muted">
            目标：{{ intakeTarget.库房名称 }} · {{ intakeTarget.存放器物类别 }} ·
            当前 {{ intakeCurrent }}/{{ intakeCapacity }} 件，剩余
            <strong :class="{ zero: intakeRemain === 0 }">{{ intakeRemain }}</strong>
            （当前版本 v{{ intakeVersion }}）
          </p>
          <label class="filter-item batch-name">
            <span>批次名称</span>
            <input v-model="intake.batchName" placeholder="如：T0304 第三批石器" />
          </label>
          <div class="pool-head">
            <span>待入藏遗物池（{{ pendingPool.length }} 件），已选 {{ selectedArtifactIds.length }} 件</span>
            <div>
              <button class="link" type="button" @click="toggleAllPool">全选/全不选</button>
            </div>
          </div>
          <ul class="pool-list">
            <li v-for="item in pendingPool" :key="String(item.id)">
              <label>
                <input
                  type="checkbox"
                  :checked="selectedArtifactIds.includes(Number(item.id))"
                  @change="toggleArtifact(Number(item.id))"
                />
                <span>{{ item.器物编号 }}</span>
                <span class="muted">{{ item.器物类型 }} · {{ item.器物质地 }} · 出土 {{ item.出土探方 }} {{ item.出土层位 }}</span>
              </label>
            </li>
          </ul>
          <p v-if="!pendingPool.length" class="lane-empty">待入藏池已空，需先在其他流程产出「已编号」遗物或清理封存架位。</p>
        </div>
        <footer class="modal-foot">
          <button
            class="btn"
            type="button"
            :disabled="!selectedArtifactIds.length"
            @click="simulateContentionNow"
            title="基于同一版本挂起两笔相同申请并立即逐笔办理，演示同一架位只能一笔成功"
          >
            模拟两批同时申请此架位
          </button>
          <span class="foot-spacer" />
          <button class="btn ghost" type="button" @click="closeIntake">取消</button>
          <button class="btn" type="button" :disabled="!selectedArtifactIds.length" @click="submitIntakeApplication">
            提交存放申请
          </button>
          <button class="btn primary" type="button" :disabled="!selectedArtifactIds.length" @click="placeNow">
            直接办理入藏
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, resetModule } from '@/api/local-service'
import {
  cancelApplication,
  clearApplications,
  listApplications,
  loadCapacity,
  pendingArtifacts,
  placeDirect,
  processAllApplications,
  processApplication,
  sealShelf,
  simulateContention,
  submitApplication,
  clearShelf,
} from '@/api/storage-service'
import type { ApplicationOutcome, CapacityBoard, EntryRow, StorageApplication } from '@/data/types'

const columns = ["架位编号", "库房名称", "存放器物类别", "架位层数", "容纳件数", "当前件数", "管理人", "架位状态"]

const board = ref<CapacityBoard>({
  warehouses: [],
  groups: [],
  rows: [],
  pending: [],
  full: [],
  sealed: [],
  totalCapacity: 0,
  totalCurrent: 0,
  totalRemain: 0,
})
const pendingPool = ref<EntryRow[]>([])
const applications = ref<StorageApplication[]>([])
const filters = reactive<Record<string, string>>({ 库房名称: '', 存放器物类别: '', 架位编号: '' })
const message = ref('')
const messageOk = ref(true)

const stats = computed(() => [
  { label: '架位总数', value: board.value.rows.length },
  { label: '总容纳件数', value: board.value.totalCapacity },
  { label: '当前总件数', value: board.value.totalCurrent },
  { label: '剩余总空间', value: board.value.totalRemain },
  { label: '已满架位', value: board.value.full.length },
  { label: '临时封存', value: board.value.sealed.length },
])

const intake = reactive<{ open: boolean; shelfId: number | null; batchName: string }>({
  open: false,
  shelfId: null,
  batchName: '',
})
const selectedArtifactIds = ref<number[]>([])

const intakeTarget = computed(() =>
  intake.shelfId === null ? undefined : board.value.rows.find((row) => Number(row.shelf.id) === intake.shelfId)?.shelf,
)
const intakeCapacity = computed(() => {
  const row = board.value.rows.find((item) => Number(item.shelf.id) === intake.shelfId)
  return row ? row.capacity : 0
})
const intakeCurrent = computed(() => {
  const row = board.value.rows.find((item) => Number(item.shelf.id) === intake.shelfId)
  return row ? row.current : 0
})
const intakeRemain = computed(() => Math.max(0, intakeCapacity.value - intakeCurrent.value))
const intakeVersion = computed(() => {
  const row = board.value.rows.find((item) => Number(item.shelf.id) === intake.shelfId)
  return row ? Number(row.shelf.version) || 1 : 1
})

function flash(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function reload() {
  board.value = loadCapacity({ ...filters })
  pendingPool.value = pendingArtifacts()
  applications.value = listApplications()
}

function resetFilters() {
  filters.库房名称 = ''
  filters.存放器物类别 = ''
  filters.架位编号 = ''
  reload()
}

function exportRows() {
  downloadEntries('storage')
}

function resetDemo() {
  resetModule('storage')
  resetModule('artifact')
  clearApplications()
  reload()
  flash('已恢复为示例数据：历史架位层数按 3 层回填，件数与出土遗物清单对齐')
}

function shelfLabel(shelfId: number): string {
  const row = board.value.rows.find((item) => Number(item.shelf.id) === shelfId)
  return row ? String(row.shelf.架位编号) : `#${shelfId}`
}

// ---- 分区动作：封存 / 清理都实际回写出土遗物清单 ----

function runSeal(shelfId: number) {
  const result = sealShelf(shelfId)
  flash(result.message, result.ok)
  reload()
}

function runClear(shelfId: number) {
  const result = clearShelf(shelfId)
  flash(result.message, result.ok)
  reload()
}

// ---- 办理存放 ----

function openIntake(shelfId: number) {
  intake.open = true
  intake.shelfId = shelfId
  intake.batchName = ''
  selectedArtifactIds.value = []
  reload()
}

function closeIntake() {
  intake.open = false
  intake.shelfId = null
  selectedArtifactIds.value = []
}

function toggleArtifact(id: number) {
  selectedArtifactIds.value = selectedArtifactIds.value.includes(id)
    ? selectedArtifactIds.value.filter((item) => item !== id)
    : [...selectedArtifactIds.value, id]
}

function toggleAllPool() {
  selectedArtifactIds.value =
    selectedArtifactIds.value.length === pendingPool.value.length
      ? []
      : pendingPool.value.map((item) => Number(item.id))
}

function placeNow() {
  if (intake.shelfId === null) {
    return
  }
  const result = placeDirect(intake.shelfId, selectedArtifactIds.value)
  flash(result.message, result.ok)
  reload()
  if (result.ok) {
    closeIntake()
  }
}

function submitIntakeApplication() {
  if (intake.shelfId === null) {
    return
  }
  const result = submitApplication({
    batchName: intake.batchName,
    shelfId: intake.shelfId,
    artifactIds: selectedArtifactIds.value,
  })
  flash(result.message, result.ok)
  selectedArtifactIds.value = []
  reload()
}

/** 多批遗物同时申请同一架位：只能一笔成功，后到的请求明确失败。 */
function simulateContentionNow() {
  if (intake.shelfId === null) {
    return
  }
  const { outcomes } = simulateContention(intake.shelfId, selectedArtifactIds.value)
  announceOutcomes(outcomes)
  reload()
}

function announceOutcomes(outcomes: ApplicationOutcome[]) {
  const failed = outcomes.filter((item) => !item.ok)
  if (failed.length === 0) {
    flash(outcomes.map((item) => item.message).join('；'))
    return
  }
  flash(outcomes.map((item) => item.message).join(' ｜ '), false)
}

function processOne(appId: number) {
  const outcome = processApplication(appId)
  flash(outcome.message, outcome.ok)
  reload()
}

function processAll() {
  const outcomes = processAllApplications()
  announceOutcomes(outcomes)
  reload()
}

function cancelOne(appId: number) {
  cancelApplication(appId)
  reload()
}

function dropApplications() {
  clearApplications()
  reload()
  flash('已清空存放申请队列')
}

onMounted(reload)
</script>

<style scoped>
.section-title {
  font-size: 15px;
  margin: 20px 0 8px;
}
.capacity-group {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}
.group-head {
  display: flex;
  gap: 14px;
  align-items: baseline;
  padding: 8px 12px;
  background: #f1f5fb;
  font-size: 13px;
}
.group-meta {
  color: var(--muted);
  font-size: 12px;
}
.capacity-table th,
.capacity-table td {
  font-size: 12px;
}
.remain {
  font-weight: 600;
  color: #15803d;
}
.remain.zero {
  color: #b42318;
}
.bar {
  width: 90px;
  height: 8px;
  background: #e8edf5;
  border-radius: 999px;
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
}
.bar-fill {
  display: block;
  height: 100%;
  background: #1f6feb;
}
.bar-fill.full {
  background: #b42318;
}
.bar-fill.sealed {
  background: #a16207;
}
.bar-text {
  font-size: 11px;
  color: var(--muted);
  margin-left: 6px;
}
.tag {
  display: inline-block;
  font-size: 11px;
  border-radius: 4px;
  padding: 0 5px;
  margin-left: 4px;
}
.tag-backfill {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.tag-warn {
  background: #ffedd5;
  color: #9a3412;
}
.status-pill {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #e2e8f0;
}
.status-pill.pending {
  background: #dcfce7;
  color: #166534;
}
.status-pill.full {
  background: #fee2e2;
  color: #991b1b;
}
.status-pill.sealed {
  background: #fef3c7;
  color: #92400e;
}
.columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.lane {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  padding: 10px;
  min-height: 140px;
}
.lane-pending {
  border-top: 3px solid #16a34a;
}
.lane-full {
  border-top: 3px solid #dc2626;
}
.lane-sealed {
  border-top: 3px solid #ca8a04;
}
.lane-head h4 {
  margin: 0 0 2px;
  font-size: 14px;
}
.lane-count {
  font-size: 12px;
  color: var(--muted);
}
.lane-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lane-item {
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.lane-line {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  margin-bottom: 2px;
}
.lane-code {
  font-weight: 600;
}
.lane-dim {
  color: var(--muted);
}
.muted {
  color: var(--muted);
}
.lane-line.actions {
  gap: 10px;
  margin-top: 4px;
}
.lane-empty {
  font-size: 12px;
  color: var(--muted);
  margin: 10px 0;
}
.btn.small {
  padding: 3px 10px;
  font-size: 12px;
}
.link.danger {
  color: #b42318;
}
.queue {
  margin-top: 16px;
}
.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.queue-actions {
  display: flex;
  gap: 8px;
}
.flash {
  font-size: 12px;
}
.flash.ok {
  color: #166534;
}
.empty-block {
  color: var(--muted);
  font-size: 13px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  width: 640px;
  max-height: 82vh;
  background: #fff;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.modal-head h4 {
  margin: 0;
  font-size: 15px;
}
.modal-body {
  padding: 12px 16px;
  overflow: auto;
}
.batch-name {
  margin-bottom: 10px;
}
.pool-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.pool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.pool-list li {
  padding: 5px 10px;
  border-bottom: 1px solid #eef2f7;
  font-size: 13px;
}
.pool-list li:last-child {
  border-bottom: none;
}
.pool-list label {
  display: flex;
  gap: 8px;
  align-items: center;
}
.modal-foot {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
}
.foot-spacer {
  flex: 1;
}
</style>
