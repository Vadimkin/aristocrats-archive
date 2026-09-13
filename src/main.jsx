import { render } from 'preact'
import { useEffect } from 'preact/hooks'
import { Router, Route, Switch, Link } from 'wouter-preact'
import { Shows } from './routes/Shows.jsx'
import { Show } from './routes/Show.jsx'
import { Settings } from './routes/Settings.jsx'
import { Player } from './components/Player.jsx'
import { restore, toggle, skip, current } from './state/player.js'
import { useTitle } from './lib/title.js'
import './styles.css'

restore()

// Old bookmarks and shared links used `#/show/<slug>`. `location.replace`
// (not replaceState) so this also works when the hash is applied to an already
// mounted page — wouter only reads pathname, and replaceState would leave it
// on `/`. BASE_URL is `/` on the root deploy and `/aristocrats/` on a sub-path
// one — strip the trailing slash so `/show/foo` lands at
// `/aristocrats/show/foo`, not `/aristocrats//show/foo`.
function redirectLegacyHash() {
  const hash = location.hash
  if (!hash.startsWith('#/')) return false
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  location.replace(base + hash.slice(1) + location.search)
  return true
}

const leavingForPath = redirectLegacyHash()
if (!leavingForPath) addEventListener('hashchange', redirectLegacyHash)

const routerBase = import.meta.env.BASE_URL.replace(/\/$/, '')

function App() {
  useKeyboardShortcuts()

  return (
    <Router base={routerBase}>
      <Switch>
        <Route path="/" component={Shows} />
        <Route path="/show/:slug">{(params) => <Show slug={params.slug} />}</Route>
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
      <Player />
    </Router>
  )
}

// A component rather than inline JSX in the Route, so that it can own the title.
function NotFound() {
  useTitle('Не знайдено')
  return (
    <div class="wrap">
      <h1>Не знайдено</h1>
      <p><Link href="/">До списку шоу</Link></p>
    </div>
  )
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      // Never steal keys from the search field or a file input.
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!current.peek() && e.key !== '/') return

      switch (e.key) {
        case ' ': e.preventDefault(); toggle(); break
        case 'ArrowLeft': case 'j': e.preventDefault(); skip(-15); break
        case 'ArrowRight': case 'l': e.preventDefault(); skip(30); break
        case 'k': e.preventDefault(); toggle(); break
        case '/': {
          const input = document.querySelector('.search')
          if (input) { e.preventDefault(); input.focus() }
          break
        }
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
}

if (!leavingForPath) render(<App />, document.getElementById('app'))
