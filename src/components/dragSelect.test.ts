import { describe, expect, it } from 'vitest'
import { dragSelection, rowIndexAt } from './dragSelect'

const ids = ['a', 'b', 'c', 'd', 'e']

describe('dragSelection', () => {
  it('selects every row between start and finger, keeping earlier picks', () => {
    expect(dragSelection(ids, ['e'], 1, 3, true)).toEqual(['e', 'b', 'c', 'd'])
  })
  it('works dragging upwards', () => {
    expect(dragSelection(ids, [], 3, 1, true)).toEqual(['b', 'c', 'd'])
  })
  it('sliding back releases rows that were only picked by the drag', () => {
    expect(dragSelection(ids, ['a'], 1, 1, true)).toEqual(['a', 'b'])
  })
  it('starting on a selected row deselects the range', () => {
    expect(dragSelection(ids, ['a', 'b', 'c', 'e'], 1, 2, false)).toEqual(['a', 'e'])
  })
})

describe('rowIndexAt', () => {
  const rows = [
    { top: 100, bottom: 180 },
    { top: 181, bottom: 260 },
    { top: 261, bottom: 340 },
  ]
  it('finds the row under the finger, including the 1px borders between rows', () => {
    expect(rowIndexAt(rows, 120)).toBe(0)
    expect(rowIndexAt(rows, 180.5)).toBe(1)
    expect(rowIndexAt(rows, 300)).toBe(2)
  })
  it('clamps above the first and below the last row', () => {
    expect(rowIndexAt(rows, 10)).toBe(0)
    expect(rowIndexAt(rows, 900)).toBe(2)
    expect(rowIndexAt([], 50)).toBe(-1)
  })
})
