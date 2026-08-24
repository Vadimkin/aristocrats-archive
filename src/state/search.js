import { signal } from '@preact/signals'

/** The header search box owns this; the show list renders against it. */
export const query = signal('')
