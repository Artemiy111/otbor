/// <reference types="vite/client" />

/** Empty means "same origin, use the contract's RPC_PATH". */
declare const __OTBOR_API_URL__: string

/** Пусто - телеметрия выключена; иначе путь на том же origin, который проксируется в коллектор. */
declare const __OTBOR_OTLP_URL__: string

declare module "*.vue" {
  import type { DefineComponent } from "vue"

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
