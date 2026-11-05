import { createApp } from "vue"
import { createPinia } from "pinia"
import { PiniaColada } from "@pinia/colada"
import { App } from "./app"
import "./app/styles/index.css"
// Importing the theme module applies the stored choice to <html> before mount.
import "./shared/lib/theme"

const app = createApp(App)

app.use(createPinia())
app.use(PiniaColada)

app.mount("#app")
