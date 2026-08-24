# Aristocrats FM — архів

Static, mobile-first site over the Aristocrats FM archive: **148 shows / 4,930 episodes**.
Two screens (show list, show detail), a persistent bottom player, and listening state in
`localStorage` with JSON export/import.

## Run

```sh
npm install
npm run dev      # rebuilds data, then starts Vite
npm run build    # -> dist/
npm run preview
```

`npm run data` alone regenerates only the data chunks.

### Episode durations

`tracks.json` carries no durations, so `scripts/scan-durations.mjs` ffprobes the local archive
once and writes `durations.json` (99 KB, committed). A normal build reads that file and never
touches the disk; if it is absent the build still works, just without lengths or totals.

```sh
node scripts/scan-durations.mjs [archiveRoot]   # default /Volumes/Vadym
```

It resumes — already-known ids are skipped — and keys on the same path hash as the build
(`scripts/lib/hash.mjs`), so the two always agree. 4,929 of 4,930 files resolve, totalling
**7,392 h**. The holdout is a `.temp.m4a`, an interrupted yt-dlp download with no finalised `moov`
atom; it is on R2 too, so it will not play in a browser either and shows no length.

## Audio

Files stream from the public Cloudflare R2 bucket in `src/config.js`:

```
https://pub-1fe55091488c44e09add307654535d58.r2.dev/
```

Override with `VITE_AUDIO_BASE` at build time.

Two constraints, both load-bearing:

- **No bucket prefix.** r2.dev serves the bucket root, so the paths from `tracks.json`
  (`aristocrats/<show>/<file>.m4a`, already percent-encoded) append directly. Re-adding the
  `aristocratsfm/` segment from the S3 endpoint 404s, and re-encoding the path breaks it.
- **No `crossorigin` on `<audio>`.** The bucket sends no `Access-Control-Allow-Origin`. A plain
  media load does not need one, but `crossorigin`, `fetch`, or Web Audio would fail — which also
  rules out a waveform/visualizer until CORS is configured.

## Data pipeline

`scripts/build-data.mjs` turns the 3.5 MB `tracks.json` into chunks a phone can load lazily:

| Output | Contents | Size |
|---|---|---|
| `public/data/index.json` | 148 shows, era-grouped | 15 KB |
| `public/data/shows/<slug>.json` | one show's episodes | 2–60 KB |
| `public/data/search.json` | `[slug, id, title]` for episode search | 346 KB, fetched on the first search |

The source is yt-dlp output, so per episode it:

- restores filename-safe glyphs (`⧸ ＂ ｜ ？ ：` → `/ " | ? :`);
- extracts the date (`(04.04.2016)`, `24/06/2021`, `08 марта 2014` — uk + ru month names) and
  season/episode (`сезон 1 эпизод 3`, `s11e51`, `Ep 4`) into fields;
- strips the repeated show-name prefix, tolerating Cyrillic/Latin homoglyphs (`5х300` vs `5x300`);
- keeps the original string in `r` as a display fallback.

Coverage: 4,180 episodes with a full date, 4,205 with a year, 3,208 with season/episode, 3,849
prefix-stripped. The 748 episodes whose filename said nothing beyond season and date get an empty
title and render as *Без назви* — their `s1e1` and `05.04.16` columns already say it.

Episode IDs are a hash of the file path, the only stable unique key. **They must not drift** —
`localStorage` keys on them. The build fails on a collision.

## Listening state

One `localStorage` key, `aristocrats.v1`, debounced ~2s and flushed on `pagehide`:

- auto-complete at 95% played (or under 30s left), and on `ended` — playback then stops;
- resume position, written every ~5s, discarded below 15s so a stray tap is not a resume point;
- manual played toggle per episode, plus mark-all / reset per show;
- durations cached on first play (the source data has none);
- per-show progress on the list, derived from snapshots without loading any show JSON;
- episode lengths come from `durations.json` at build time, so rows show them before you press
  play; the value measured during playback is only a fallback;
- a `×` on each «Продовжити» row drops the resume point without marking the episode played.
  Dismissing the episode that is currently loaded also unloads the player — otherwise the 5s
  position write would put it straight back in the list.

Position writes bypass the UI signal (`mutateQuietly`) and only notify on pause or track change —
otherwise every visible row would re-render 4× a second.

Export/import lives at `#/settings`. Import always merges — a union where done wins over not-done
and the newer `playedAt` wins for position — so nothing is ever lost. It validates the file version
and refuses mismatches.

## Header

The masthead runs the full width on every page: logo and wordmark left, gear right, over
the studio illustration behind a dark scrim that is heaviest at the top, so the white type stays
legible while the cat on the desk keeps its colour.

Its height is width-driven — `min-height: clamp(194px, 15.5vw, 380px)` — rather than fixed. The cat
occupies **27.7% of the image height** (measured: x 72.5–82.5%, y 62.6–90.4%), so with a full-bleed
`cover` background the band has to grow in step with the viewport or the illustration scales past
it and the cat crops. The floor is what the logo row needs; the ceiling keeps ultrawide screens
from getting an absurd banner, at the cost of the ear tips clipping past roughly 2450px.
`background-position: 62% 88%` centres the cat in whatever band results.

The logo is a mask filled with an embedded raster, so there is no `fill` to override —
`brightness(0) invert(1)` flattens and inverts it to white.

### The background image

Two WebP tiers, generated from `assets/studio-large.jpg` (3019×1436) by
`sh scripts/build-header-image.sh`:

| File | Used | Size |
|---|---|---|
| `public/studio-header.webp` | 1200w, below 800px | 21 KB |
| `public/studio-header-lg.webp` | 2400w, from 800px | 133 KB |

The illustration carries film grain, which JPEG handles badly — at 2400w WebP is 153 KB against
JPEG's 317 KB, and grain is why the native 3019w version costs 569 KB, so 2400w is the practical
ceiling. Below 800px the full-bleed photo was being scaled past the 1200w file's pixels, which is
what read as softness on large screens.

Both paths come from custom properties set inline from `import.meta.env.BASE_URL`, so they survive
a sub-path deploy in a way a bare `url()` in the stylesheet would not; the stylesheet swaps
`--studio` for `--studio-lg` at the breakpoint, sharing one `--scrim` between them.

Source images live in `assets/`, not `public/` — Vite copies everything under `public/` into
`dist/`, and the two originals are 4.8 MB.

## Home screen

The site installs as a standalone app — «На екран «Домівка»» in iOS Safari, the install prompt in
Chrome. `public/manifest.webmanifest` supplies the name, `display: standalone`, and the icons; its
paths are all relative (`./`, `icon-192.png`), so they resolve against the manifest's own URL and
survive the sub-path deploy without anything reading `BASE_URL`.

Icons come from `assets/cat-with-light-logo.jpg` (1041²) via `sh scripts/build-icons.sh`, in two
crops, because one framing cannot cover the whole size range:

| File | Used | Crop |
|---|---|---|
| `public/apple-touch-icon.png` | iOS home screen, 180² | full artwork |
| `public/icon-192.png`, `icon-512.png` | manifest, install prompt, Android splash | full artwork |
| `public/favicon-16.png`, `favicon-32.png` | browser tab | centre 600², the «A» mark |

At 180px up, the room and the cat still read and they are what makes the icon recognisable. At
16px the full scene is a smudge, so the favicon crops to the mark — which sits centred in the
artwork, so a plain centre crop lands on it. The 512 is also declared `purpose: maskable`: the
mark sits well inside the 80% safe circle, so Android can round or crop the frame without touching
it.

iOS ignores the manifest's `theme_color`, taking `apple-mobile-web-app-status-bar-style` instead.
That is set to `black-translucent`, so the page runs under the status bar — every route renders the
dark masthead band, so the white status-bar text has contrast everywhere.

Running under the status bar means the safe-area inset is only clearance, not breathing room: at
1× the logo sits level with the clock. So the masthead takes `padding-top:
calc(env(safe-area-inset-top) * 1.35)` and adds the inset to its `min-height`, keeping the band's
designed height *below* the status bar instead of letting the inset eat into it. Both terms
collapse to the old numbers in a browser tab, where the inset is 0.

## Layout

`--measure` on a `.page` wrapper drives the masthead, the search bar and the content together, so
they stay aligned at every width. The list page widens it (58rem at 700px, 72rem at 1080px) and
flows shows into 2 then 3 columns; everything else stays at 44rem. The show list uses CSS multicol
rather than grid because an alphabetical list reads better down each column than across rows.

## Search

A sticky bar directly under the masthead on the list page, so it stays reachable down a 148-row
list. One field covers both kinds of result: «Шоу» (matched against the show index, already loaded)
and «Епізоди» (matched against the lazy `search.json`, capped at 60 hits), with every match wrapped
in `<mark>`. The query lives in a signal (`src/state/search.js`) so it survives navigating into a
show and back. The field is 16px so iOS does not zoom the page on focus.

## Notes

- Hash routing (`#/`, `#/show/:slug`, `#/settings`) — no server rewrites needed, and the `<audio>`
  element never unmounts, so playback survives navigation.
- Player: one episode at a time — play/pause, ±15/30s, scrubber, volume, MediaSession lock-screen
  controls. No queue, so nothing plays after the current episode ends.
- Keyboard: `space`/`k` play-pause, `←`/`→` seek, `/` focus search.
- Initial payload is ~25 KB gzipped.
- Settings live behind the gear in the header (`#/settings`).
- Deploy `dist/` to any static host. The build is pinned to the `/aristocrats/` sub-path
  (`base` in `vite.config.js`), which is where dev is served from; every asset and data URL is
  built from `import.meta.env.BASE_URL`, so nothing else needs touching. For a root deploy:
  `BASE_PATH=/ npm run build`.
