import type { FilterName } from './image'
import type { PageSize, Quality } from './export'
import { detectLang, LANGS, type Lang } from '../i18n'
import { migrateTheme, type DarkLook, type LightLook, type ThemeMode } from '../themes'

export interface Settings {
  lang: Lang
  langChosen: boolean // false until the first-launch language picker has been answered
  theme: ThemeMode
  lightLook: LightLook
  darkLook: DarkLook
  pageSize: PageSize
  quality: Quality
  defaultFilter: FilterName
}

const KEY = 'anyscan.settings'
export const DEFAULT_SETTINGS: Settings = { lang: 'en', langChosen: false, theme: 'auto', lightLook: 'classic', darkLook: 'midnight', pageSize: 'auto', quality: 'high', defaultFilter: 'magic' }

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(KEY)
    const raw = JSON.parse(stored || '{}') as Record<string, unknown>
    return { ...DEFAULT_SETTINGS, ...raw, ...migrateTheme(raw), ...migrateLang(raw, stored != null) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * Up to v1.2.0 a missing language meant "follow the phone". People who already used the app keep
 * the language they were seeing; new installs start in English and are asked on first launch.
 */
export function migrateLang(raw: Record<string, unknown>, existingUser: boolean, phoneLangs?: readonly string[]): Pick<Settings, 'lang' | 'langChosen'> {
  const valid = LANGS.some((l) => l.code === raw.lang)
  // Before langChosen existed, an explicit language could only come from the user picking it.
  if (valid) return { lang: raw.lang as Lang, langChosen: typeof raw.langChosen === 'boolean' ? raw.langChosen : true }
  if (existingUser && raw.langChosen === undefined) return { lang: detectLang(phoneLangs), langChosen: true }
  return { lang: 'en', langChosen: raw.langChosen === true }
}

export function storeSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode: settings just won't persist */
  }
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore quota / private mode */
  }
}
