/**
 * Third-party analytics, ad and widget hosts hh.ru loads. A form read or a
 * response needs none of them; they only cost time (some beacons hang for ten
 * seconds). Hosts of hh itself are never listed.
 */
const BLOCKED_HOSTS: ReadonlyArray<string> = [
  "mc.yandex.ru",
  "mc.yandex.com",
  "top-fwz1.mail.ru",
  "top.mail.ru",
  "counter.yadro.ru",
  "vk.com",
  "st.hybrid.ai",
  "eye.targetads.io",
  "rap.skcrtxr.com",
  "weborama-tech.ru",
  "weborama.fr",
  "googletagmanager.com",
  "google-analytics.com",
  "adriver.ru",
  "doubleclick.net"
]

export const isTrackerHost = (hostname: string): boolean =>
  BLOCKED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))

export const isTrackerUrl = (url: string): boolean => {
  try {
    return isTrackerHost(new URL(url).hostname)
  } catch {
    return false
  }
}
