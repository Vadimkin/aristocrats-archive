// Plausible's script tags are injected into index.html only for production
// builds (see the plausible() plugin in vite.config.js), so `window.plausible`
// simply does not exist under `npm run dev`. Every call goes through here so a
// dev run is silent rather than a TypeError, and so no component has to know
// whether the tracker happens to be loaded.
//
// The file is not named analytics.js: content blockers treat that path as a
// tracker and refuse the module, which takes the whole Vite graph down and
// leaves a white page.
export function track(event, props) {
  window.plausible?.(event, props ? { props } : undefined)
}
