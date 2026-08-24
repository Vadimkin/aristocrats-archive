import { useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import { exportBlob, exportFilename, importMerge, resetAll } from '../state/storage.js'
import { Header } from '../components/Header.jsx'
import { useTitle } from '../lib/title.js'

export function Settings() {
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  useTitle('Налаштування')

  function download() {
    const url = URL.createObjectURL(exportBlob())
    const a = document.createElement('a')
    a.href = url
    a.download = exportFilename()
    a.click()
    URL.revokeObjectURL(url)
    setMsg('Файл збережено')
    setErr(null)
  }

  async function importFile(file) {
    setMsg(null)
    setErr(null)
    if (!file) return
    try {
      const { added, updated } = importMerge(JSON.parse(await file.text()))
      setMsg(`Обʼєднано: додано ${added}, оновлено ${updated}`)
    } catch (e) {
      setErr(e.message ?? 'Не вдалося прочитати файл')
    }
  }

  return (
    <div class="page">
      <Header />
      <div class="wrap settings">
        <div class="backrow">
          <Link href="/">← Усі шоу</Link>
        </div>

        <h1>Налаштування</h1>
      <p class="note">
        Стан прослуховування зберігається лише у цьому браузері. Експортуйте файл, щоб перенести
        його на інший пристрій.
      </p>

      <div class="section-head"><h2>Експорт</h2></div>
      <div class="actions">
        <button onClick={download}>↓ Зберегти файл</button>
      </div>

      <div class="section-head"><h2>Імпорт</h2></div>
      <p class="note">
        Дані з файлу завжди обʼєднуються з поточними: прослухане з обох боків зберігається,
        свіжіша позиція перемагає. Нічого не втрачається.
      </p>
      <input
        class="file"
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          importFile(e.currentTarget.files?.[0])
          e.currentTarget.value = ''
        }}
      />

      {msg && <p class="note ok">{msg}</p>}
      {err && <p class="note bad">{err}</p>}

      <div class="section-head"><h2>Небезпечна зона</h2></div>
      <div class="actions">
        <button
          class="danger"
          onClick={() => {
            if (confirm('Стерти весь стан прослуховування? Це не можна скасувати.')) {
              resetAll()
              setMsg('Стан стерто')
              setErr(null)
            }
          }}
        >
          Стерти все
        </button>
      </div>
      </div>
    </div>
  )
}
