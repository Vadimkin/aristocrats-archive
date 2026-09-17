// Translate show names/descriptions to Ukrainian via DeepL, emit a picker
// HTML, and apply only the rows you select.
//
// DEEPL_AUTH_KEY=... node scripts/translate-shows-uk.mjs
// node scripts/translate-shows-uk.mjs --html
// node scripts/translate-shows-uk.mjs --revert
// node scripts/translate-shows-uk.mjs --apply-selection

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from './lib/db.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_PATH = join(ROOT, 'scripts/data/show-translations.json')
const SELECTION_PATH = join(ROOT, 'scripts/data/show-translation-selection.json')
const HTML_PATH = join(ROOT, 'show-translations.html')
const KEY = process.env.DEEPL_AUTH_KEY
const ENDPOINT = 'https://api-free.deepl.com/v2/translate'
const BATCH = 50
const ARGS = new Set(process.argv.slice(2))

function chunks(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function translateAll(texts) {
  const translated = new Array(texts.length)
  let offset = 0
  for (const batch of chunks(texts, BATCH)) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: batch,
        target_lang: 'UK',
        preserve_formatting: true,
        context:
          'Titles and descriptions of radio shows from Aristocrats FM. Translate into Ukrainian. Keep personal names. Prefer established Ukrainian radio-show titles over literal calques.',
      }),
    })
    const body = await res.text()
    if (!res.ok) {
      throw new Error(`DeepL ${res.status}: ${body.slice(0, 500)}`)
    }
    const json = JSON.parse(body)
    if (!json.translations || json.translations.length !== batch.length) {
      throw new Error(`DeepL returned ${json.translations?.length} for batch of ${batch.length}`)
    }
    json.translations.forEach((t, i) => {
      translated[offset + i] = t.text
    })
    offset += batch.length
    console.log(`translated ${offset}/${texts.length}`)
  }
  return translated
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function changed(a, b) {
  return (a ?? '').trim() !== (b ?? '').trim()
}

function loadRows() {
  return JSON.parse(readFileSync(JSON_PATH, 'utf8'))
}

function emptySelection() {
  return { renameNames: [], renameDescs: [] }
}

function loadSelection() {
  try {
    const raw = JSON.parse(readFileSync(SELECTION_PATH, 'utf8'))
    return {
      renameNames: raw.renameNames ?? [],
      renameDescs: raw.renameDescs ?? [],
    }
  } catch {
    return emptySelection()
  }
}

function htmlPage(rows, selection = emptySelection()) {
  const nameSet = new Set(selection.renameNames)
  const descSet = new Set(selection.renameDescs)
  const nameChanges = rows.filter((r) => changed(r.oldName, r.newName)).length
  const descChanges = rows.filter((r) => changed(r.oldDesc, r.newDesc)).length
  const cards = rows
    .map((r) => {
      const nameDiff = changed(r.oldName, r.newName)
      const descDiff = changed(r.oldDesc, r.newDesc)
      const any = nameDiff || descDiff
      const nameOn = nameDiff && nameSet.has(r.id)
      const descOn = descDiff && descSet.has(r.id)
      const flags = [
        nameDiff ? '<span class="tag tag-name">назва</span>' : '',
        descDiff ? '<span class="tag tag-desc">опис</span>' : '',
        any ? '' : '<span class="tag tag-same">без змін</span>',
      ].join('')
      const oldDesc = r.oldDesc
        ? `<p class="old">${esc(r.oldDesc)}</p>`
        : `<p class="missing">немає опису</p>`
      const newDesc = r.newDesc
        ? `<p class="new">${esc(r.newDesc)}</p>`
        : `<p class="missing">немає опису</p>`
      const nameBox = nameDiff
        ? `<label class="pick"><input type="checkbox" data-field="name" data-id="${r.id}"${nameOn ? ' checked' : ''} /> перекласти назву</label>`
        : ''
      const descBox = descDiff
        ? `<label class="pick"><input type="checkbox" data-field="desc" data-id="${r.id}"${descOn ? ' checked' : ''} /> перекласти опис</label>`
        : ''
      return `<article class="card ${any ? 'changed' : 'unchanged'}" data-q="${esc((r.oldName + ' ' + r.newName).toLowerCase())}" data-id="${r.id}">
  <header>
    <span class="id">#${r.id}</span>
    ${flags}
    <span class="picks">${nameBox}${descBox}</span>
  </header>
  <div class="pair names">
    <div>
      <h3 class="old">${esc(r.oldName)}</h3>
    </div>
    <div>
      <h3 class="new">${esc(r.newName)}</h3>
    </div>
  </div>
  <div class="pair">
    <div>${oldDesc}</div>
    <div>${newDesc}</div>
  </div>
</article>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Вибір перекладів шоу — Архів Аристократів</title>
  <style>
    :root {
      --bg: #f4f1ea;
      --ink: #1c1914;
      --muted: #6b6458;
      --old: #8a2f2f;
      --new: #1f5c3a;
      --card: #fffdf8;
      --line: #e4ddd0;
      --accent: #1f5c3a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 16px/1.45 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      color: var(--ink);
      background: var(--bg);
      padding-bottom: 5.5rem;
    }
    header.hero {
      padding: 2.5rem 1.25rem 1.5rem;
      max-width: 72rem;
      margin: 0 auto;
    }
    h1 { font-size: 1.75rem; margin: 0 0 .4rem; font-weight: 600; }
    .lede { color: var(--muted); margin: 0 0 1.25rem; }
    .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .stat {
      background: var(--card);
      border: 1px solid var(--line);
      padding: .55rem .85rem;
      border-radius: 8px;
    }
    .stat b { display: block; font-size: 1.25rem; }
    .stat span { color: var(--muted); font-size: .85rem; }
    .toolbar {
      display: flex; gap: .75rem; flex-wrap: wrap; align-items: center;
    }
    input[type="search"] {
      flex: 1; min-width: 16rem;
      font: inherit; padding: .55rem .75rem;
      border: 1px solid var(--line); border-radius: 8px; background: var(--card);
    }
    label.toggle { color: var(--muted); display: flex; gap: .4rem; align-items: center; }
    main { max-width: 72rem; margin: 0 auto; padding: 0 1.25rem 3rem; }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 1rem 1.1rem 1.15rem;
      margin-bottom: .85rem;
    }
    .card.on { border-color: #b7d4c3; box-shadow: 0 0 0 1px #b7d4c3 inset; }
    .card header { display: flex; gap: .4rem; align-items: center; margin-bottom: .6rem; flex-wrap: wrap; }
    .id { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: .3rem; }
    .picks { margin-left: auto; display: flex; gap: .6rem; flex-wrap: wrap; }
    .pick {
      font: 13px/1.2 system-ui, sans-serif;
      display: flex; gap: .35rem; align-items: center;
      color: var(--ink);
      background: #eef6f0;
      border-radius: 999px;
      padding: .28rem .6rem;
    }
    .tag {
      font: 12px/1.2 system-ui, sans-serif;
      padding: .2rem .45rem;
      border-radius: 999px;
      background: #eee8dc;
      color: var(--muted);
    }
    .tag-name { background: #f3d9d4; color: var(--old); }
    .tag-desc { background: #d7eadc; color: var(--new); }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    .pair h3 { margin: 0 0 .35rem; font-size: 1.15rem; font-weight: 600; }
    .old { color: var(--old); }
    .new { color: var(--new); }
    .pair p { margin: 0; white-space: pre-wrap; }
    .missing { color: var(--muted); font-style: italic; }
    .bar {
      position: sticky;
      bottom: 0;
      background: #1c1914;
      color: #f4f1ea;
      padding: .85rem 1.25rem;
      display: flex;
      gap: .6rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .bar button {
      font: 14px/1.2 system-ui, sans-serif;
      border: 0;
      border-radius: 8px;
      padding: .55rem .8rem;
      cursor: pointer;
      background: #fffdf8;
      color: #1c1914;
    }
    .bar button.primary { background: #3d8f62; color: #fff; }
    .bar .sum { margin-left: auto; font: 14px/1.3 system-ui, sans-serif; color: #d9d2c5; }
    @media (max-width: 720px) {
      .pair { grid-template-columns: 1fr; }
      .bar .sum { margin-left: 0; }
    }
    body.filter-changed .unchanged { display: none; }
  </style>
</head>
<body class="filter-changed">
  <header class="hero">
    <h1>Які шоу перекладати?</h1>
    <p class="lede">Ліворуч — як зараз, праворуч — український варіант. Позначте, що замінювати; непозначене лишається старим.</p>
    <div class="stats">
      <div class="stat"><b>${rows.length}</b><span>шоу</span></div>
      <div class="stat"><b>${nameChanges}</b><span>інших назв</span></div>
      <div class="stat"><b>${descChanges}</b><span>інших описів</span></div>
    </div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Пошук за назвою…" />
      <label class="toggle"><input type="checkbox" id="onlyChanged" checked /> лише зі змінами</label>
    </div>
  </header>
  <main>
${cards}
  </main>
  <div class="bar">
    <button type="button" id="allNames">Усі назви</button>
    <button type="button" id="allDescs">Усі описи</button>
    <button type="button" id="none">Нічого</button>
    <button type="button" class="primary" id="copy">Копіювати вибір</button>
    <span class="sum" id="summary"></span>
  </div>
  <script>
    const STORAGE = 'aristocrats-show-translation-picks'
    const q = document.getElementById('q')
    const only = document.getElementById('onlyChanged')
    const cards = [...document.querySelectorAll('.card')]
    const boxes = [...document.querySelectorAll('input[data-field]')]
    const summary = document.getElementById('summary')

    function selection() {
      return {
        renameNames: boxes.filter((b) => b.dataset.field === 'name' && b.checked).map((b) => Number(b.dataset.id)),
        renameDescs: boxes.filter((b) => b.dataset.field === 'desc' && b.checked).map((b) => Number(b.dataset.id)),
      }
    }

    function paint() {
      document.body.classList.toggle('filter-changed', only.checked)
      const needle = q.value.trim().toLowerCase()
      for (const card of cards) {
        const hideSearch = needle && !card.dataset.q.includes(needle)
        card.hidden = hideSearch
        const on = [...card.querySelectorAll('input[data-field]')].some((b) => b.checked)
        card.classList.toggle('on', on)
      }
      const s = selection()
      summary.textContent = 'Перекласти ' + s.renameNames.length + ' назв і ' + s.renameDescs.length + ' описів'
      localStorage.setItem(STORAGE, JSON.stringify(s))
    }

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null')
      if (saved) {
        const names = new Set(saved.renameNames || [])
        const descs = new Set(saved.renameDescs || [])
        for (const box of boxes) {
          box.checked = box.dataset.field === 'name'
            ? names.has(Number(box.dataset.id))
            : descs.has(Number(box.dataset.id))
        }
      }
    } catch {}

    q.addEventListener('input', paint)
    only.addEventListener('change', paint)
    for (const box of boxes) box.addEventListener('change', paint)

    document.getElementById('allNames').onclick = () => {
      for (const box of boxes) if (box.dataset.field === 'name') box.checked = true
      paint()
    }
    document.getElementById('allDescs').onclick = () => {
      for (const box of boxes) if (box.dataset.field === 'desc') box.checked = true
      paint()
    }
    document.getElementById('none').onclick = () => {
      for (const box of boxes) box.checked = false
      paint()
    }
    document.getElementById('copy').onclick = async () => {
      const text = JSON.stringify(selection(), null, 2)
      await navigator.clipboard.writeText(text)
      summary.textContent = 'Скопійовано. Вставте JSON у чат — застосую вибір.'
    }

    paint()
  </script>
</body>
</html>
`
}

function applyRows(sqlite, rows, selection) {
  const renameNames = new Set(selection.renameNames)
  const renameDescs = new Set(selection.renameDescs)
  const upsertName = sqlite.prepare(`
    INSERT INTO show_overrides (show_id, name) VALUES (?, ?)
    ON CONFLICT(show_id) DO UPDATE SET name = excluded.name
  `)
  const deleteName = sqlite.prepare('DELETE FROM show_overrides WHERE show_id = ?')
  const updateDesc = sqlite.prepare('UPDATE shows SET description = ? WHERE id = ?')

  return sqlite.transaction(() => {
    let names = 0
    let descs = 0
    for (const row of rows) {
      if (renameNames.has(row.id) && changed(row.oldName, row.newName)) {
        upsertName.run(row.id, row.newName)
        names++
      } else {
        deleteName.run(row.id)
      }
      if (changed(row.oldDesc, row.newDesc)) {
        if (renameDescs.has(row.id) && row.newDesc) {
          updateDesc.run(row.newDesc, row.id)
          descs++
        } else {
          updateDesc.run(row.oldDesc, row.id)
        }
      }
    }
    return { names, descs }
  })()
}

function writeHtml(rows, selection) {
  writeFileSync(HTML_PATH, htmlPage(rows, selection))
}

const { sqlite } = open()

if (ARGS.has('--html')) {
  const rows = loadRows()
  writeHtml(rows, loadSelection())
  sqlite.close()
  console.log('wrote show-translations.html')
  process.exit(0)
}

if (ARGS.has('--revert')) {
  const rows = loadRows()
  const applied = applyRows(sqlite, rows, emptySelection())
  writeHtml(rows, emptySelection())
  writeFileSync(SELECTION_PATH, JSON.stringify(emptySelection(), null, 2) + '\n')
  sqlite.close()
  console.log(`reverted names ${applied.names} descriptions ${applied.descs}`)
  process.exit(0)
}

if (ARGS.has('--apply-selection')) {
  const rows = loadRows()
  const selection = loadSelection()
  const applied = applyRows(sqlite, rows, selection)
  writeHtml(rows, selection)
  sqlite.close()
  console.log(`applied names ${applied.names}`)
  console.log(`applied descriptions ${applied.descs}`)
  process.exit(0)
}

if (ARGS.has('--apply-json')) {
  const rows = loadRows()
  const selection = {
    renameNames: rows.filter((r) => changed(r.oldName, r.newName)).map((r) => r.id),
    renameDescs: rows.filter((r) => changed(r.oldDesc, r.newDesc)).map((r) => r.id),
  }
  const applied = applyRows(sqlite, rows, selection)
  writeHtml(rows, selection)
  writeFileSync(SELECTION_PATH, JSON.stringify(selection, null, 2) + '\n')
  sqlite.close()
  console.log(`overrides names ${applied.names}`)
  console.log(`updated descriptions ${applied.descs}`)
  process.exit(0)
}

if (!KEY) {
  console.error('Set DEEPL_AUTH_KEY')
  process.exit(1)
}

const shows = sqlite
  .prepare('SELECT id, slug, name, description FROM shows ORDER BY ord')
  .all()

const nameTexts = shows.map((s) => s.name)
const descShows = shows.filter((s) => s.description)
console.log(`shows ${shows.length}, descriptions ${descShows.length}`)

const newNames = await translateAll(nameTexts)
const newDescs = await translateAll(descShows.map((s) => s.description))
const descById = new Map(descShows.map((s, i) => [s.id, newDescs[i]]))

const rows = shows.map((s, i) => ({
  id: s.id,
  slug: s.slug,
  oldName: s.name,
  newName: newNames[i],
  oldDesc: s.description,
  newDesc: s.description ? descById.get(s.id) : null,
}))

writeFileSync(JSON_PATH, JSON.stringify(rows, null, 2))
writeHtml(rows, emptySelection())
writeFileSync(SELECTION_PATH, JSON.stringify(emptySelection(), null, 2) + '\n')
sqlite.close()
console.log('wrote translations JSON and picker HTML (DB unchanged)')
