const PREFIX = '../../assets/podcasts/'

const images = import.meta.glob('../../assets/podcasts/*.{avif,gif,jpeg,jpg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** Resolve the filename stored in show JSON to Vite's emitted asset URL. */
export const podcastImage = (filename) =>
  filename ? images[`${PREFIX}${filename}`] ?? null : null
