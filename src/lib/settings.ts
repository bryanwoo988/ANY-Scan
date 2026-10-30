import type { FilterName } from './image'
import type { PageSize, Quality } from './export'
import type { Lang } from '../i18n'
import type { ThemeId } from '../themes'

export interface Settings {
  lang: Lang | null // null = follow the phone's language
  theme: ThemeId
  pageSize: PageSize
  quality: Quality
  defaultFilter: FilterName
}

const KEY = 'anyscan.settings'
export const DEFAULT_SETTINGS: Settings = { lang: null, theme: 'system', pageSize: 'auto', quality: 'high', defaultFilter: 'magic' }

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
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
