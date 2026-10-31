import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildXlsx, cellText, cellValue, colName, toTable, wordsToItems } from './sheet'
import type { TextItem } from './office'

const it_ = (str: string, x: number, y: number, fs = 10): TextItem => ({ str, x, y, w: str.length * fs * 0.5, fs })

describe('toTable', () => {
  it('builds columns from a simple invoice table, numbers right-aligned', () => {
    const items = [
      it_('INVOICE', 250, 40, 18),
      it_('Item', 50, 100), it_('Qty', 300, 100), it_('Price', 400, 100),
      it_('Notebook', 50, 115), it_('2', 310, 115), it_('12.50', 400, 115),
      it_('A4 paper ream', 50, 130), it_('10', 305, 130), it_('8.90', 405, 130),
      it_('Stapler', 50, 145), it_('1', 310, 145), it_('25.00', 400, 145),
      it_('46.40', 400, 165),
    ]
    expect(toTable(items)).toEqual([
      ['INVOICE'],
      ['Item', 'Qty', 'Price'],
      ['Notebook', '2', '12.50'],
      ['A4 paper ream', '10', '8.90'],
      ['Stapler', '1', '25.00'],
      ['', '', '46.40'],
    ])
  })
  it('keeps words of a cell together (word spaces are not column gaps)', () => {
    const items = [it_('Total', 50, 100), it_('amount', 78, 100), it_('99.00', 300, 100), it_('Tax', 50, 115), it_('5.00', 300, 115)]
    expect(toTable(items)).toEqual([['Total amount', '99.00'], ['Tax', '5.00']])
  })
  it('a page of prose becomes one line per row', () => {
    expect(toTable([it_('Hello there', 50, 100), it_('second line', 50, 115)])).toEqual([['Hello there'], ['second line']])
  })
  it('works on OCR word boxes', () => {
    const w = (text: string, x0: number, y0: number) => ({ text, x0, y0, x1: x0 + text.length * 14, y1: y0 + 26, lh: 30, line: Math.round(y0 / 50) })
    const items = wordsToItems([w('Name', 40, 100), w('Score', 400, 102), w('Ali', 40, 150), w('88', 410, 151), w('Mei', 40, 200), w('92', 410, 199)])
    expect(toTable(items)).toEqual([['Name', 'Score'], ['Ali', '88'], ['Mei', '92']])
  })
})

describe('tilted photos', () => {
  it('straightens rows of a photo tilted by ~2°, using the OCR lines', () => {
    const k = 0.035 // the right end of each row sits 35 px lower per 1000 px
    const w = (text: string, x0: number, row: number) => ({ text, x0, y0: 100 + row * 40 + k * x0, x1: x0 + 60, y1: 126 + row * 40 + k * x0, lh: 30, line: row })
    const words = [w('Name', 40, 0), w('Score', 900, 0), w('Ali', 40, 1), w('88', 900, 1), w('Mei', 40, 2), w('92', 900, 2)]
    expect(toTable(wordsToItems(words))).toEqual([['Name', 'Score'], ['Ali', '88'], ['Mei', '92']])
  })
})

describe('cellValue', () => {
  it('parses numbers and money', () => {
    expect(cellValue('1,234.50')).toEqual({ v: 1234.5, fmt: 4 })
    expect(cellValue('8.90')).toEqual({ v: 8.9, fmt: 2 })
    expect(cellValue('2,100')).toEqual({ v: 2100, fmt: 3 })
    expect(cellValue('3.14159')).toBe(3.14159)
    expect(cellValue('-12')).toBe(-12)
    expect(cellValue('(45.00)')).toEqual({ v: -45, fmt: 2 })
    expect(cellValue('RM 45.90')).toEqual({ v: 45.9, fmt: 2 })
    expect(cellValue('12%')).toEqual({ v: 0.12, fmt: 9 })
    expect(cellText(cellValue('2,391.36'))).toBe('2,391.36')
    expect(cellText(cellValue('6%'))).toBe('6%')
  })
  it('keeps codes, IC and phone numbers as text', () => {
    expect(cellValue('007')).toBe('007')
    expect(cellValue('900101-14-5678')).toBe('900101-14-5678')
    expect(cellValue('012-345 6789')).toBe('012-345 6789')
    expect(cellValue('1234567890123456')).toBe('1234567890123456')
    expect(cellValue('')).toBe(null)
  })
})

describe('xlsx', () => {
  it('column names', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })
  it('writes sheets with numbers, text and percentages; sheet names sanitised and unique', async () => {
    const blob = buildXlsx([
      { name: 'Page 1', rows: [['Item', 'Price'], ['A & B', 12.5], ['Tax', { v: 0.06, fmt: 9 }]] },
      { name: 'Page/1', rows: [['x']] },
      { name: 'Page 1', rows: [] },
    ])
    const z = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const s1 = strFromU8(z['xl/worksheets/sheet1.xml'])
    expect(s1).toContain('<c r="B2"><v>12.5</v></c>')
    expect(s1).toContain('<c r="B3" s="4"><v>0.06</v></c>')
    expect(s1).toContain('A &amp; B')
    const wb = strFromU8(z['xl/workbook.xml'])
    expect(wb).toContain('name="Page 1"')
    expect(wb).toContain('name="Page 1 (2)"')
    expect(wb).toContain('name="Page 1 (3)"')
  })
})
