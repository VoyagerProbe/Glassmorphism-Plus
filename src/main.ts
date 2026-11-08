import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { setupIconify } from '@/utils/iconify'
import { message } from '@/utils/message'
import App from './App.vue'
import router from './router'

import './styles/main.css'
import './styles/a2-home.css'
import './styles/a2-rails.css'
import './styles/scheme2-surfaces.css'
import './styles/detail-ping.css'

window.$message = message

setupIconify().catch((err) => {
  console.warn('[main] iconify init failed', err)
})

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(router)

app.mount('#app')
