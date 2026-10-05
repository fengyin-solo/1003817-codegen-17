<template>
  <section class="page" data-module="storage">
    <header class="page-head">
      <div>
        <h2>库房管理</h2>
        <p class="page-desc">维护库房架位，围绕架位编号、库房名称、存放器物类别、架位层数做登记、筛选与状态流转；库位容量视图按库房、层数与器物类别汇总容纳、在库与剩余空间。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记库房架位</button>
        <button class="btn" type="button" @click="exportRows">导出库房管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="capacity-view">
      <h3 class="section-title">库位容量视图</h3>
      <p class="section-hint">按库房、架位层数与器物类别汇总；历史架位缺失层数按 1 层、容纳件数按每层 20 件回填。</p>
      <div v-for="group in groups" :key="group.warehouse" class="warehouse-panel">
        <header class="warehouse-head">
          <strong>{{ group.warehouse }}</strong>
          <span>容纳 {{ group.capacity }} 件 · 在库 {{ group.current }} 件 · 剩余 {{ group.remaining }} 件</span>
        </header>
        <table class="data-table">
          <thead>
            <tr>
              <th>架位编号</th>
              <th>架位层数</th>
              <th>器物类别</th>
              <th>容纳件数</th>
              <th>当前件数</th>
              <th>剩余空间</th>
              <th>架位状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="shelf in group.shelves" :key="shelf.id">
              <td>{{ shelf.code }}</td>
              <td>{{ shelf.layers }}</td>
              <td>{{ shelf.category }}</td>
              <td>{{ shelf.capacity }}</td>
              <td>{{ shelf.current }}</td>
              <td :class="{ 'remaining-empty': shelf.remaining === 0 }">{{ shelf.remaining }}</td>
              <td>{{ shelf.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!groups.length" class="empty-state">暂无库房架位，可先登记库房架位</p>
    </section>

    <section class="column-row">
      <div class="column-card">
        <h4 class="column-title">待入藏器物（{{ pendingArtifacts.length }}）</h4>
        <ul class="chip-list">
          <li v-for="item in pendingArtifacts" :key="String(item.id)" class="chip">
            {{ item['器物编号'] }} · {{ item['器物类型'] }} · {{ item['完残程度'] }}
          </li>
          <li v-if="!pendingArtifacts.length" class="empty-state">暂无待入藏器物</li>
        </ul>
      </div>
      <div class="column-card">
        <h4 class="column-title">已满架位（{{ fullShelves.length }}）</h4>
        <ul class="chip-list">
          <li v-for="item in fullShelves" :key="String(item.id)" class="chip">
            {{ item['架位编号'] }} · {{ item['库房名称'] }} · {{ item['当前件数'] }}/{{ item['容纳件数'] }} 件
          </li>
          <li v-if="!fullShelves.length" class="empty-state">暂无已满架位</li>
        </ul>
      </div>
      <div class="column-card">
        <h4 class="column-title">临时封存架位（{{ sealedShelves.length }}）</h4>
        <ul class="chip-list">
          <li v-for="item in sealedShelves" :key="String(item.id)" class="chip">
            {{ item['架位编号'] }} · {{ item['库房名称'] }} · 在库 {{ item['当前件数'] }} 件
          </li>
          <li v-if="!sealedShelves.length" class="empty-state">暂无临时封存架位</li>
        </ul>
      </div>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="String(row.status) !== '临时封存'">
              <button class="link" type="button" @click="openStore(row)">存放器物</button>
              <button class="link" type="button" @click="runShelfAction('调整整理', row)">调整整理</button>
              <button class="link" type="button" @click="runShelfAction('临时封存', row)">临时封存</button>
              <button
                v-if="Number(row['当前件数']) > 0"
                class="link"
                type="button"
                @click="runShelfAction('清理下架', row)"
              >清理下架</button>
            </template>
            <button v-else class="link" type="button" @click="runShelfAction('解除封存', row)">解除封存</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无库房管理数据，可先登记库房架位</td>
        </tr>
      </tbody>
    </table>

    <div v-if="storeDialog.open" class="dialog-mask">
      <div class="dialog">
        <h3 class="dialog-title">办理存放 · {{ storeDialog.code }}</h3>
        <p class="dialog-desc">
          存放类别：{{ storeDialog.category }} · 剩余空间：{{ storeDialog.remaining }} 件 · 已选 {{ storeDialog.selected.length }} 件
        </p>
        <ul class="candidate-list">
          <li v-for="item in storeDialog.candidates" :key="String(item.id)">
            <label class="candidate-item">
              <input
                v-model="storeDialog.selected"
                type="checkbox"
                :value="Number(item.id)"
                :disabled="isCandidateDisabled(item)"
              />
              {{ item['器物编号'] }} · {{ item['器物类型'] }} · {{ item['出土探方'] }} · {{ item['完残程度'] }}
            </label>
          </li>
          <li v-if="!storeDialog.candidates.length" class="empty-state">
            「{{ storeDialog.category }}」类别暂无待入藏器物
          </li>
        </ul>
        <p v-if="storeDialog.error" class="error-text">{{ storeDialog.error }}</p>
        <div class="dialog-actions">
          <button
            class="btn primary"
            type="button"
            :disabled="!storeDialog.selected.length"
            @click="confirmStore"
          >确认入藏</button>
          <button class="btn ghost" type="button" @click="closeStore">取消</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条库房管理记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  clearShelf,
  loadStorageOverview,
  sealShelf,
  storeArtifacts,
  tidyShelf,
  unsealShelf,
} from '@/api/storage-service'
import { remainingOf } from '@/data/storage-ops'
import type { WarehouseCapacityGroup } from '@/data/storage-ops'
import type { ActionResult, EntryRow } from '@/data/types'

const meta = moduleMeta('storage')
const columns = ["架位编号", "库房名称", "存放器物类别", "架位层数", "容纳件数", "当前件数", "管理人", "架位状态"]
const statuses = ["正常使用", "已满", "待整理", "临时封存"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const groups = ref<WarehouseCapacityGroup[]>([])
const pendingArtifacts = ref<EntryRow[]>([])
const fullShelves = ref<EntryRow[]>([])
const sealedShelves = ref<EntryRow[]>([])
const totals = reactive({ shelves: 0, capacity: 0, current: 0, remaining: 0 })

const stats = computed(() => [
  { label: '架位总数', value: totals.shelves },
  { label: '总容纳件数', value: totals.capacity },
  { label: '当前在库件数', value: totals.current },
  { label: '剩余空间', value: totals.remaining },
  { label: '待入藏器物', value: pendingArtifacts.value.length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const storeDialog = reactive({
  open: false,
  shelfId: 0,
  code: '',
  category: '',
  remaining: 0,
  version: 1,
  candidates: [] as EntryRow[],
  selected: [] as number[],
  error: '',
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '库房架位登记入口尚未接入审批流'
}

function runShelfAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const id = Number(row.id)
  let result: ActionResult
  switch (action) {
    case '调整整理':
      result = tidyShelf(id)
      break
    case '临时封存':
      result = sealShelf(id)
      break
    case '解除封存':
      result = unsealShelf(id)
      break
    case '清理下架':
      result = clearShelf(id)
      break
    default:
      result = { ok: false, message: `库房架位没有登记「${action}」这个动作` }
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function openStore(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  storeDialog.open = true
  storeDialog.shelfId = Number(row.id)
  storeDialog.code = String(row['架位编号'])
  storeDialog.category = String(row['存放器物类别'])
  storeDialog.remaining = remainingOf(row)
  // 打开弹窗时记下架位版本号，提交时若已被别的申请变更则明确失败。
  storeDialog.version = Number(row.version)
  storeDialog.candidates = pendingArtifacts.value.filter(
    (item) => String(item['器物类型']) === storeDialog.category,
  )
  storeDialog.selected = []
  storeDialog.error = ''
}

function closeStore() {
  storeDialog.open = false
  storeDialog.error = ''
}

function isCandidateDisabled(item: EntryRow): boolean {
  const id = Number(item.id)
  return !storeDialog.selected.includes(id) && storeDialog.selected.length >= storeDialog.remaining
}

function confirmStore() {
  const result = storeArtifacts(storeDialog.shelfId, [...storeDialog.selected], storeDialog.version)
  if (!result.ok) {
    // 后到的申请必须明确失败：错误留在弹窗里，同时刷新底层数字。
    storeDialog.error = result.message
    reload()
    return
  }
  storeDialog.open = false
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const overview = loadStorageOverview()
    groups.value = overview.groups
    pendingArtifacts.value = overview.pendingArtifacts
    fullShelves.value = overview.fullShelves
    sealedShelves.value = overview.sealedShelves
    totals.shelves = overview.shelves.length
    totals.capacity = overview.groups.reduce((sum, group) => sum + group.capacity, 0)
    totals.current = overview.groups.reduce((sum, group) => sum + group.current, 0)
    totals.remaining = overview.groups.reduce((sum, group) => sum + group.remaining, 0)
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '库房管理列表读取失败'
  }
}

onMounted(reload)
</script>
