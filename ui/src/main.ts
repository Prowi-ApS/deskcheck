import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import Dashboard from './pages/Dashboard.vue'
import RunDetail from './pages/RunDetail.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/run/:id', component: RunDetail },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')
