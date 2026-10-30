import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { notice } from './notifications.ts'
import './style.css'

const app = createApp(App)
app.use(createPinia())
app.config.errorHandler = (error: unknown) => {
  notice.value = { text: error instanceof Error ? error.message : '操作发生错误', type: 'error' }
  console.error(error)
}
app.mount('#app')
