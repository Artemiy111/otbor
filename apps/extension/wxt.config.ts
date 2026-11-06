import { defineConfig } from "wxt"

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  // A throwaway browser profile for `wxt dev`, so dev never touches the daily one.
  webExt: {
    binaries: { firefox: "/Applications/Zen.app/Contents/MacOS/zen" },
    firefoxProfile: `${import.meta.dirname}/.dev-profile/zen`,
    chromiumProfile: `${import.meta.dirname}/.dev-profile/chrome`,
    keepProfileChanges: true,
    startUrls: ["https://hh.ru/search/vacancy?text=typescript"]
  },
  manifest: {
    name: "otbor",
    description: "Сохраняет открытые страницы hh.ru в otbor и показывает на них данные из вашей базы.",
    permissions: ["storage", "declarativeNetRequest"],
    // Third-party analytics and ad hosts hh loads; hh's own /anatskytics is left alone (its antibot reads it).
    declarative_net_request: { rule_resources: [{ id: "trackers", enabled: true, path: "block-trackers.json" }] },
    host_permissions: ["*://*.hh.ru/*", "http://127.0.0.1/*", "http://localhost/*"],
    action: { default_title: "otbor" },
    browser_specific_settings: { gecko: { id: "otbor@art.local", strict_min_version: "115.0", data_collection_permissions: { required: ["none"] } } } as never
  }
})
