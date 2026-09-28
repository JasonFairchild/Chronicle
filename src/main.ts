import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { requestPersistentStorage } from './composables/useStoragePersistence'
import router from './router'

// Before anything is written, so the first draft is already covered.
void requestPersistentStorage()

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
