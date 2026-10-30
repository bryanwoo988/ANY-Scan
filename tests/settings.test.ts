import { describe, expect, it } from 'vitest'
import { migrateLang } from '../src/lib/settings'

describe('migrateLang', () => {
  it('new install: English, and the picker has not been answered', () => {
    expect(migrateLang({}, false)).toEqual({ lang: 'en', langChosen: false })
  })
  it('existing user who followed the phone keeps the language they were seeing', () => {
    expect(migrateLang({ lang: null }, true, ['zh-Hans-MY'])).toEqual({ lang: 'zh', langChosen: true })
    expect(migrateLang({ theme: 'dark' }, true, ['ms-MY'])).toEqual({ lang: 'ms', langChosen: true })
  })
  it('existing user who picked a language keeps it', () => {
    expect(migrateLang({ lang: 'ms' }, true)).toEqual({ lang: 'ms', langChosen: true })
  })
  it('respects the saved answer state', () => {
    expect(migrateLang({ lang: 'en', langChosen: false }, true)).toEqual({ lang: 'en', langChosen: false })
    expect(migrateLang({ lang: 'zh', langChosen: true }, true)).toEqual({ lang: 'zh', langChosen: true })
  })
})
