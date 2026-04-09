import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import V0RunList from './pages/V0RunList.vue'
import V1Overview from './pages/V1Overview.vue'
import V2Criterion from './pages/V2Criterion.vue'
import V3Subtask from './pages/V3Subtask.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'runs', component: V0RunList },
  { path: '/runs/:planId', name: 'run', component: V1Overview, props: true },
  {
    path: '/runs/:planId/criteria/:criterionId',
    name: 'criterion',
    component: V2Criterion,
    props: true,
  },
  {
    path: '/runs/:planId/tasks/:taskId',
    name: 'subtask',
    component: V3Subtask,
    props: true,
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
