import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Builds the same sources for Chromium (service worker) and Firefox/Zen
 * (event page). Output: dist/chrome and dist/firefox, loadable as unpacked
 * extensions.
 */
const root = import.meta.dirname
const targets = ["chrome", "firefox"] as const

const manifest = (target: (typeof targets)[number]) => ({
  manifest_version: 3,
  name: "otbor",
  version: "0.1.0",
  description: "Сохраняет открытые страницы hh.ru в otbor и показывает на них данные из вашей базы.",
  permissions: ["storage"],
  host_permissions: ["*://*.hh.ru/*", "http://127.0.0.1/*", "http://localhost/*"],
  action: { default_title: "otbor", default_popup: "popup.html" },
  content_scripts: [
    { matches: ["*://*.hh.ru/*"], js: ["content.js"], run_at: "document_idle" }
  ],
  ...(target === "chrome"
    ? { background: { service_worker: "background.js" } }
    : {
        background: { scripts: ["background.js"] },
        browser_specific_settings: { gecko: { id: "otbor@art.local", strict_min_version: "115.0" } }
      })
})

for (const target of targets) {
  const outdir = join(root, "dist", target)
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })

  const result = await Bun.build({
    entrypoints: ["background", "content", "popup"].map((name) => join(root, "src", `${name}.ts`)),
    outdir,
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none"
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  await cp(join(root, "static", "popup.html"), join(outdir, "popup.html"))
  await writeFile(join(outdir, "manifest.json"), JSON.stringify(manifest(target), null, 2))
  console.log(`built ${target} -> ${outdir}`)
}
