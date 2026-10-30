import { describe, expect, it } from 'vitest'
import { DICTS, detectLang, makeT } from '../src/i18n'

describe('i18n', () => {
  it('every language has every key, with no empty strings', () => {
    const keys = Object.keys(DICTS.en).sort()
    for (const d of Object.values(DICTS)) {
      expect(Object.keys(d).sort()).toEqual(keys)
      for (const v of Object.values(d)) expect(v.trim()).not.toBe('')
    }
  })
  it('keeps {placeholders} consistent across languages', () => {
    for (const [k, v] of Object.entries(DICTS.en)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
      expect(ph(DICTS.zh[k as keyof typeof DICTS.zh]), `zh ${k}`).toEqual(ph(v))
      expect(ph(DICTS.ms[k as keyof typeof DICTS.ms]), `ms ${k}`).toEqual(ph(v))
    }
  })
  it('detects the phone language', () => {
    expect(detectLang(['zh-Hans-MY'])).toBe('zh')
    expect(detectLang(['ms-MY', 'en'])).toBe('ms')
    expect(detectLang(['fr-FR', 'en-GB'])).toBe('en')
    expect(detectLang(['ja'])).toBe('en')
  })
  it('interpolates variables', () => {
    expect(makeT('en')('nSelected', { n: 3 })).toBe('3 selected')
    expect(makeT('zh')('nSelected', { n: 3 })).toBe('已选 3 项')
  })
})
