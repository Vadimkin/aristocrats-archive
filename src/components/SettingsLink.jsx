import { Link } from 'wouter-preact'

// 8-tooth gear on a 20×20 grid, stroked in currentColor so it picks up the
// link colour and both themes without extra rules.
const GEAR =
  'M8.86 1.48 L11.14 1.48 L11.72 3.94 L13.07 4.50 L15.22 3.16 L16.84 4.78 ' +
  'L15.50 6.93 L16.06 8.28 L18.52 8.86 L18.52 11.14 L16.06 11.72 L15.50 13.07 ' +
  'L16.84 15.22 L15.22 16.84 L13.07 15.50 L11.72 16.06 L11.14 18.52 L8.86 18.52 ' +
  'L8.28 16.06 L6.93 15.50 L4.78 16.84 L3.16 15.22 L4.50 13.07 L3.94 11.72 ' +
  'L1.48 11.14 L1.48 8.86 L3.94 8.28 L4.50 6.93 L3.16 4.78 L4.78 3.16 ' +
  'L6.93 4.50 L8.28 3.94 Z'

export function SettingsLink() {
  return (
    <Link class="gear" href="/settings" aria-label="Налаштування" title="Налаштування">
      <svg
        viewBox="0 0 20 20"
        width="19"
        height="19"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={GEAR} />
        <circle cx="10" cy="10" r="2.9" />
      </svg>
    </Link>
  )
}
