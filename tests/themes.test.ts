import { describe, expect, it } from 'vitest'
import { activeLook, migrateTheme, resolveSide } from '../src/themes'

describe('appearance', () => {
  it('auto follows the phone, fixed modes do not', () => {
    expect(resolveSide('auto', true)).toBe('dark')
    expect(resolveSide('auto', false)).toBe('light')
    expect(resolveSide('light', true)).toBe('light')
    expect(resolveSide('dark', false)).toBe('dark')
  })
  it('uses the light look by day and the dark look at night', () => {
    const p = { theme: 'auto' as const, lightLook: 'mint' as const, darkLook: 'grape' as const }
    expect(activeLook(p, false)).toBe('mint')
    expect(activeLook(p, true)).toBe('grape')
  })
  it('migrates v1.2.0 single-theme settings', () => {
    expect(migrateTheme({ theme: 'system' })).toEqual({ theme: 'auto', lightLook: 'classic', darkLook: 'midnight' })
    expect(migrateTheme({ theme: 'black' })).toEqual({ theme: 'dark', lightLook: 'classic', darkLook: 'oled' })
    expect(migrateTheme({ theme: 'sakura' })).toEqual({ theme: 'light', lightLook: 'lavender', darkLook: 'midnight' })
    expect(migrateTheme({})).toEqual({ theme: 'auto', lightLook: 'classic', darkLook: 'midnight' })
  })
  it('keeps valid new-style settings and rejects junk', () => {
    expect(migrateTheme({ theme: 'dark', lightLook: 'paper', darkLook: 'slate' })).toEqual({ theme: 'dark', lightLook: 'paper', darkLook: 'slate' })
    expect(migrateTheme({ theme: 'dark', lightLook: 'nope', darkLook: 42 })).toEqual({ theme: 'dark', lightLook: 'classic', darkLook: 'midnight' })
  })
})
