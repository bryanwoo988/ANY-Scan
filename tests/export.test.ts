import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildDocx, safeFileName } from '../src/lib/export'

describe('buildDocx', () => {
  it('produces a zip with an escaped document body', async () => {
    const blob = buildDocx('Hello <World> & 你好\nLine 2')
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
    const doc = strFromU8(files['word/document.xml'])
    expect(doc).toContain('Hello &lt;World&gt; &amp; 你好')
    expect(doc.match(/<w:p>/g)).toHaveLength(2)
  })
})

describe('safeFileName', () => {
  it('strips characters that are invalid in file names', () => {
    expect(safeFileName('a/b:c*?"<>|d')).toBe('a_b_c_d')
    expect(safeFileName('   ')).toBe('AnyScan')
  })
})
