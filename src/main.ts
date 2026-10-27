import './assets/main.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { requestPersistentStorage } from './composables/useStoragePersistence'
import router from './router'

void requestPersistentStorage() // Before any write, so the first draft is already covered.

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
