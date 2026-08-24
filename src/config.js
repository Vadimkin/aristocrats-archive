// Public Cloudflare R2 bucket. The r2.dev host serves the bucket root, so paths
// from tracks.json ("aristocrats/<show>/<file>.m4a") append directly — do NOT
// re-add the "aristocratsfm/" bucket segment from the old S3 endpoint (404s).
//
// The bucket sends no Access-Control-Allow-Origin. A bare <audio src> does not
// need it, but adding crossorigin / fetch / Web Audio would break playback.
export const AUDIO_BASE =
  import.meta.env.VITE_AUDIO_BASE ?? 'https://pub-1fe55091488c44e09add307654535d58.r2.dev/'

// Paths in tracks.json are already percent-encoded. Never encode them again.
export const audioUrl = (path) => AUDIO_BASE + path

export const STORAGE_KEY = 'aristocrats.v1'
export const STORAGE_VERSION = 1

// An episode counts as finished at 95% played, or with under 30s to go —
// most shows end with an outro nobody sits through.
export const DONE_RATIO = 0.95
export const DONE_TAIL_SECONDS = 30

// Below this, a play is an accidental tap rather than a resumable position.
export const MIN_RESUME_SECONDS = 15
