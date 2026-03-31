<script setup lang="ts">
import { ref, watch, inject } from 'vue'
import { RUN_DATA_KEY } from '../composables/useRunData'
import { sortIndicator } from '../utils/format'
import FileDetailPanel from './FileDetailPanel.vue'

const props = defineProps<{ initialFile?: string | null }>()
const emit = defineEmits<{ 'file-opened': [] }>()

const data = inject(RUN_DATA_KEY)!

const selectedFile = ref<string | null>(null)

// Open file passed from another tab (e.g. task row click)
watch(() => props.initialFile, (file) => {
  if (file) {
    selectedFile.value = file
    emit('file-opened')
  }
}, { immediate: true })

function selectFile(path: string) {
  selectedFile.value = path
}

function closeDetail() {
  selectedFile.value = null
}
</script>

<template>
  <div class="files-tab">
    <div class="files-layout" :class="{ 'has-detail': selectedFile }">
      <!-- File list panel -->
      <div class="file-list-panel">
        <div class="file-filter-bar">
          <button type="button" class="file-filter-btn" :class="{ active: data.fileFilter.value === 'all' }" @click="data.fileFilter.value = 'all'">All ({{ data.fileCounts.value.total }})</button>
          <button type="button" class="file-filter-btn matched" :class="{ active: data.fileFilter.value === 'matched' }" @click="data.fileFilter.value = 'matched'">Matched ({{ data.fileCounts.value.matched }})</button>
          <button type="button" class="file-filter-btn unmatched" :class="{ active: data.fileFilter.value === 'unmatched' }" @click="data.fileFilter.value = 'unmatched'">Not covered ({{ data.fileCounts.value.unmatched }})</button>
        </div>

        <table class="file-table">
          <thead>
            <tr>
              <th class="sortable" @click="data.toggleFileSort('path')">File{{ sortIndicator(data.fileSortKey.value === 'path', data.fileSortAsc.value) }}</th>
              <th>Status</th>
              <th class="sortable num" @click="data.toggleFileSort('findings')">Issues{{ sortIndicator(data.fileSortKey.value === 'findings', data.fileSortAsc.value) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in data.fileRows.value"
              :key="row.path"
              :class="[{
                unmatched: !row.matched,
                clickable: row.matched,
                selected: selectedFile === row.path
              }]"
              @click="row.matched ? selectFile(row.path) : undefined"
            >
              <td class="file-cell">
                <span class="file-name">{{ row.filename }}</span>
                <span class="file-dir">{{ row.directory }}</span>
              </td>
              <td>
                <span v-if="row.matched" class="file-status matched">reviewed</span>
                <span v-else class="file-status not-covered">not covered</span>
              </td>
              <td class="num issues-cell">
                <template v-if="row.matched">
                  <span v-if="row.critical" class="sev-count critical">{{ row.critical }}</span>
                  <span v-if="row.warning" class="sev-count warning">{{ row.warning }}</span>
                  <span v-if="row.info" class="sev-count info">{{ row.info }}</span>
                  <span v-if="row.issueCount === 0" class="clean-badge">clean</span>
                </template>
                <span v-else class="dim">&mdash;</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Detail panel -->
      <div v-if="selectedFile" class="file-detail-panel">
        <FileDetailPanel :file-path="selectedFile" @close="closeDetail" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.files-tab { max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }

.files-layout { display: flex; gap: 1.5rem; }
.files-layout:not(.has-detail) .file-list-panel { width: 100%; }
.files-layout.has-detail .file-list-panel { width: 38%; flex-shrink: 0; }
.files-layout.has-detail .file-detail-panel { flex: 1; min-width: 0; }

.file-filter-bar { display: flex; gap: 0.35rem; margin-bottom: 0.75rem; }
.file-filter-btn { padding: 0.3rem 0.65rem; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-muted); font-size: 0.6875rem; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
.file-filter-btn:hover { background: var(--bg-card-hover); }
.file-filter-btn.active { background: var(--bg-card); color: var(--accent); border-color: var(--accent); font-weight: 600; }
.file-filter-btn.matched.active { color: var(--color-complete); border-color: rgba(102, 187, 106, 0.4); }
.file-filter-btn.unmatched.active { color: var(--text-muted); border-color: var(--text-muted); }

.file-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.file-table thead th { padding: 0.4rem 0.6rem; text-align: left; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); background: var(--bg-expand); border-bottom: 1px solid var(--border); }
.file-table tbody td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); }
.file-table tbody tr:last-child td { border-bottom: none; }
.file-table tbody tr:hover { background: var(--bg-card-hover); }
.file-table tbody tr.clickable { cursor: pointer; }
.file-table tbody tr.clickable:hover { background: rgba(79, 195, 247, 0.08); }
.file-table tbody tr.selected { background: rgba(79, 195, 247, 0.12); }
.file-table tbody tr.unmatched { opacity: 0.6; }
.file-table .num { text-align: right; font-family: var(--font-mono); font-size: 0.7rem; }
.file-table .sortable { cursor: pointer; user-select: none; }
.file-table .sortable:hover { color: var(--accent); }

.file-cell { display: flex; flex-direction: column; gap: 0.05rem; }
.file-name { font-family: var(--font-mono); font-weight: 500; font-size: 0.75rem; }
.file-dir { font-size: 0.6875rem; color: var(--text-muted); }

.file-status { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; padding: 0.1rem 0.35rem; border-radius: 3px; }
.file-status.matched { background: rgba(102, 187, 106, 0.15); color: var(--color-complete); }
.file-status.not-covered { background: rgba(90, 100, 120, 0.2); color: var(--text-muted); }

.issues-cell { display: flex; gap: 0.2rem; justify-content: flex-end; align-items: center; }
.sev-count { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; padding: 0.1rem 0.3rem; border-radius: 3px; }
.sev-count.critical { background: rgba(239, 83, 80, 0.2); color: var(--color-critical); }
.sev-count.warning { background: rgba(255, 167, 38, 0.15); color: var(--color-warning); }
.sev-count.info { background: rgba(79, 195, 247, 0.1); color: var(--color-info); }
.clean-badge { font-size: 0.6875rem; color: var(--color-complete); font-style: italic; }
.dim { color: var(--text-muted); }
</style>
