export const DEFAULT_PROXY_PORT = 27890
export const DEFAULT_CONTROLLER_PORT = 29090
export const DEFAULT_PROXY_GROUP = "otbor"
export const DEFAULT_PROXY_SECRET = "otbor-local"
export const DEFAULT_MAX_ROTATIONS = 3

/**
 * Parallel workers get their own mihomo listener and selector group, so each
 * session has its own exit IP. Ports are fixed: compose publishes the same
 * 27891–27905 range, and unused workers simply stay idle.
 */
export const MAX_WORKERS = 15
export const HOST_WORKER_PORT_BASE = 27890
export const CONTAINER_WORKER_PORT_BASE = 7900

export const workerGroup = (index: number): string => `otbor-${index + 1}`
