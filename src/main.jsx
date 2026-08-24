import { render } from 'preact'
import { useEffect } from 'preact/hooks'
import { Router, Route, Switch, Link } from 'wouter-preact'
import { useHashLocation } from 'wouter-preact/use-hash-location'
import { Shows } from './routes/Shows.jsx'
import { Show } from './routes/Show.jsx'
import { Settings } from './routes/Settings.jsx'
import { Player } from './components/Player.jsx'
import { restore, toggle, skip, current } from './state/player.js'
import { useTitle } from './lib/title.js'
import './styles.css'

restore()

function App() {
  useKeyboardShortcuts()

  return (
    <Router hook={useHashLocation}>
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

render(<App />, document.getElementById('app'))
