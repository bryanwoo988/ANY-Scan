// Appearance themes. "system" follows the phone's light/dark setting (defined in styles.css);
// every other theme is applied by setting these CSS variables on <html>.

export type ThemeId = 'system' | 'light' | 'dark' | 'black' | 'ocean' | 'forest' | 'sakura' | 'sunset'

export interface ThemeVars {
  bg: string
  bg2: string
  card: string
  card2: string
  line: string
  text: string
  muted: string
  accent: string
  accent2: string
  accentInk: string
  scheme: 'light' | 'dark'
}

const DARK: ThemeVars = { bg: '#0e1116', bg2: '#161a21', card: '#1c212a', card2: '#252b36', line: '#2b3240', text: '#f1f4f8', muted: '#8f99a8', accent: '#2fbf8f', accent2: '#2f6bff', accentInk: '#04150f', scheme: 'dark' }
const LIGHT: ThemeVars = { bg: '#f4f6f9', bg2: '#ffffff', card: '#ffffff', card2: '#eef1f5', line: '#e2e6ec', text: '#12161c', muted: '#677285', accent: '#13a879', accent2: '#2f6bff', accentInk: '#ffffff', scheme: 'light' }

export const THEMES: Record<Exclude<ThemeId, 'system'>, ThemeVars> = {
  light: LIGHT,
  dark: DARK,
  black: { bg: '#000000', bg2: '#0a0a0a', card: '#131313', card2: '#1d1d1d', line: '#262626', text: '#f5f5f5', muted: '#8c8c8c', accent: '#2fbf8f', accent2: '#2f6bff', accentInk: '#04150f', scheme: 'dark' },
  ocean: { bg: '#0b1426', bg2: '#101c33', card: '#15233f', card2: '#1d2e50', line: '#24375c', text: '#eef3ff', muted: '#8ea2c8', accent: '#3ea6ff', accent2: '#6c5cff', accentInk: '#04121f', scheme: 'dark' },
  forest: { bg: '#0c1712', bg2: '#11211a', card: '#162a21', card2: '#1e382c', line: '#254536', text: '#eaf6ef', muted: '#8fb3a0', accent: '#4cd38a', accent2: '#1fa8a0', accentInk: '#04150c', scheme: 'dark' },
  sakura: { bg: '#fff5f8', bg2: '#ffffff', card: '#ffffff', card2: '#fde6ee', line: '#f6d3df', text: '#2a1520', muted: '#8a6474', accent: '#e8508a', accent2: '#9b6bff', accentInk: '#ffffff', scheme: 'light' },
  sunset: { bg: '#fff7ef', bg2: '#ffffff', card: '#ffffff', card2: '#fdebd8', line: '#f3dcc4', text: '#2b1a0c', muted: '#8a6a4c', accent: '#f07a1a', accent2: '#e8508a', accentInk: '#ffffff', scheme: 'light' },
}

export const THEME_ORDER: ThemeId[] = ['system', 'light', 'dark', 'black', 'ocean', 'forest', 'sakura', 'sunset']

const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches

/** Colours a theme resolves to right now (system → light or dark). */
export function resolveTheme(id: ThemeId): ThemeVars {
  return id === 'system' ? (systemDark() ? DARK : LIGHT) : THEMES[id]
}

export function applyTheme(id: ThemeId): void {
  const root = document.documentElement
  const v = resolveTheme(id)
  const vars: Record<string, string> = {
    '--bg': v.bg, '--bg-2': v.bg2, '--card': v.card, '--card-2': v.card2, '--line': v.line,
    '--text': v.text, '--muted': v.muted, '--accent': v.accent, '--accent-2': v.accent2, '--accent-ink': v.accentInk,
  }
  if (id === 'system') {
    Object.keys(vars).forEach((k) => root.style.removeProperty(k))
    root.removeAttribute('data-theme')
  } else {
    Object.entries(vars).forEach(([k, val]) => root.style.setProperty(k, val))
    root.setAttribute('data-theme', v.scheme)
  }
  // Status bar / browser chrome colour follows the theme.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', v.bg))
}
