// Appearance, matching the Bible and Machine Learning apps: a mode (auto / light / dark) plus
// one of four looks for each side. "auto" follows the phone, using the chosen light look by day
// and the chosen dark look at night. The colours live in styles.css under [data-palette].

export type ThemeMode = 'auto' | 'light' | 'dark'
export const LIGHT_LOOKS = ['classic', 'paper', 'mint', 'lavender'] as const
export const DARK_LOOKS = ['midnight', 'oled', 'slate', 'grape'] as const
export type LightLook = (typeof LIGHT_LOOKS)[number]
export type DarkLook = (typeof DARK_LOOKS)[number]
export type Look = LightLook | DarkLook

/** Preview colours for the picker: background, card, accent. */
export const LOOK_COLOURS: Record<Look, [string, string, string]> = {
  classic: ['#f6f8fc', '#ffffff', '#13a879'],
  paper: ['#f6f1e7', '#fffdf8', '#a8571a'],
  mint: ['#eef7f3', '#ffffff', '#0b7f62'],
  lavender: ['#f5f3fc', '#ffffff', '#5b45c4'],
  midnight: ['#0e131f', '#151c2b', '#2fbf8f'],
  oled: ['#000000', '#0d0d0d', '#2fbf8f'],
  slate: ['#23272f', '#2c313b', '#8cbcea'],
  grape: ['#17121f', '#221a2e', '#b89dff'],
}

export interface ThemePrefs {
  theme: ThemeMode
  lightLook: LightLook
  darkLook: DarkLook
}

const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches

export function resolveSide(mode: ThemeMode, prefersDark = systemDark()): 'light' | 'dark' {
  return mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode
}

export function activeLook(p: ThemePrefs, prefersDark = systemDark()): Look {
  return resolveSide(p.theme, prefersDark) === 'dark' ? p.darkLook : p.lightLook
}

export function applyTheme(p: ThemePrefs): void {
  const root = document.documentElement
  const side = resolveSide(p.theme)
  root.dataset.theme = side
  root.dataset.palette = side === 'dark' ? p.darkLook : p.lightLook
  // Status bar / browser chrome colour follows the look.
  const bg = LOOK_COLOURS[root.dataset.palette as Look][0]
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg))
}

/** Settings saved by v1.2.0 used a single theme id; map them onto mode + looks. */
export function migrateTheme(raw: Record<string, unknown>): ThemePrefs {
  const old = raw.theme as string | undefined
  const lightLook = LIGHT_LOOKS.includes(raw.lightLook as LightLook) ? (raw.lightLook as LightLook) : 'classic'
  const darkLook = DARK_LOOKS.includes(raw.darkLook as DarkLook) ? (raw.darkLook as DarkLook) : 'midnight'
  const legacy: Record<string, Partial<ThemePrefs>> = {
    system: { theme: 'auto' },
    black: { theme: 'dark', darkLook: 'oled' },
    ocean: { theme: 'dark', darkLook: 'midnight' },
    forest: { theme: 'dark', darkLook: 'slate' },
    sakura: { theme: 'light', lightLook: 'lavender' },
    sunset: { theme: 'light', lightLook: 'paper' },
  }
  const base: ThemePrefs = { theme: old === 'light' || old === 'dark' || old === 'auto' ? old : 'auto', lightLook, darkLook }
  return { ...base, ...(old ? legacy[old] : undefined) }
}
