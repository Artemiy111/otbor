/**
 * Cheap speedups for hh pages: cards below the fold are not laid out until
 * scrolled to, and images load lazily. Nothing here changes what hh shows.
 */
const STYLE_ID = "otbor-perf"

const CSS = `
[data-qa="vacancy-serp__vacancy"] {
  content-visibility: auto;
  contain-intrinsic-size: auto 220px;
}
`

export const installPerf = (): void => {
  if (document.getElementById(STYLE_ID) === null) {
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.append(style)
  }
  lazyImages()
}

/** Marks images lazy once; hh re-renders cards, so it runs on every repaint. */
export const lazyImages = (): void => {
  for (const image of document.querySelectorAll<HTMLImageElement>("img:not([loading])")) {
    // The first screen keeps its eager images.
    if (image.getBoundingClientRect().top < window.innerHeight) continue
    image.loading = "lazy"
    image.decoding = "async"
  }
}
