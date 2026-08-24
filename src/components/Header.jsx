import { Link } from 'wouter-preact'
import { SettingsLink } from './SettingsLink.jsx'

const base = import.meta.env.BASE_URL

export function Header() {
  return (
    <header
      class="masthead"
      // Via custom properties so the paths survive a sub-path deploy, which a
      // plain url() in the stylesheet would not. The stylesheet picks which
      // one to use by viewport width.
      style={{
        '--studio': `url(${base}studio-header.webp)`,
        '--studio-lg': `url(${base}studio-header-lg.webp)`,
      }}
    >
      <div class="masthead-inner">
        <Link class="brand" href="/" aria-label="Аристократи — на головну">
          <img src={`${base}logo.svg`} alt="" width="34" height="44" />
          <span class="wordmark">Аристократи</span>
        </Link>

        <p class="tagline">Архів випущених подкастів</p>

        <SettingsLink />
      </div>
    </header>
  )
}
