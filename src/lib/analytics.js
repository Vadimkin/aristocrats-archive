// Plausible's script tags are injected into index.html only for production
// builds (see the plausible() plugin in vite.config.js), so `window.plausible`
// simply does not exist under `npm run dev`. Every call goes through here so a
// dev run is silent rather than a TypeError, and so no component has to know
// whether analytics happens to be loaded.
export function track(event, props) {
  window.plausible?.(event, props ? { props } : undefined)
}
