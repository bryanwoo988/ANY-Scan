import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildDocxPages, buildPptx, parasFromText, slideSize, toLines, toParagraphs, type TextItem } from './office'

const item = (str: string, x: number, y: number, fs = 11, w = str.length * fs * 0.5): TextItem => ({ str, x, y, w, fs })

describe('toLines', () => {
  it('joins items on the same baseline left to right, with spaces at gaps', () => {
    const lines = toLines([item('world', 120, 100), item('Hello', 72, 100.4), item('Next line', 72, 114)])
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Next line'])
  })
  it('does not put spaces between Chinese characters', () => {
    expect(toLines([item('你好', 72, 100, 12, 24), item('世界', 97, 100, 12, 24)])[0].text).toBe('你好世界')
  })
})

describe('toParagraphs', () => {
  const page = 595
  it('splits on larger gaps, keeps wrapped lines together, re-joins hyphenation', () => {
    const lines = toLines([
      item('Annual Report', 220, 80, 22, 150),
      item('This is the first para-', 72, 130),
      item('graph of text.', 72, 144),
      item('Second paragraph.', 72, 180),
    ])
    const p = toParagraphs(lines, page)
    expect(p.map((x) => x.text)).toEqual(['Annual Report', 'This is the first paragraph of text.', 'Second paragraph.'])
    expect(p[0]).toMatchObject({ bold: true, center: true })
    expect(p[1]).toMatchObject({ bold: false, center: false })
  })
  it('OCR text: blank lines separate paragraphs', () => {
    expect(parasFromText('line one\nline two\n\nnew para').map((p) => p.text)).toEqual(['line one line two', 'new para'])
  })
})

describe('slideSize', () => {
  it('16:9 page → 10 in wide slide', () => {
    expect(slideSize(960, 540)).toEqual({ cx: 9144000, cy: 5143500 })
  })
  it('portrait A4 → 7.5 in tall slide', () => {
    const s = slideSize(595, 842)
    expect(s.cy).toBe(6858000)
    expect(s.cx).toBeCloseTo(6858000 * (595 / 842), -1)
  })
})

describe('Office files', () => {
  const jpg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
  it('docx has one section per page, text escaped, images linked', async () => {
    const blob = await buildDocxPages([
      { kind: 'text', w: 595, h: 842, paras: [{ text: 'A & B <c>\u0001', fs: 11, bold: false, center: false }] },
      { kind: 'image', w: 842, h: 595, image: jpg },
    ])
    const z = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const doc = strFromU8(z['word/document.xml'])
    expect(doc).toContain('A &amp; B &lt;c&gt;</w:t>')
    expect(doc.match(/<w:sectPr>/g)).toHaveLength(2)
    expect(doc).toContain('w:orient="landscape"')
    expect(strFromU8(z['word/_rels/document.xml.rels'])).toContain('media/page1.jpg')
    expect(z['word/media/page1.jpg']).toBeDefined()
  })
  it('pptx lists every slide in presentation, rels and content types', async () => {
    const blob = await buildPptx([
      { kind: 'image', w: 960, h: 540, image: jpg },
      { kind: 'text', w: 960, h: 540, lines: [{ text: 'Title', x: 100, y: 100, w: 200, fs: 30 }] },
    ])
    const z = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(strFromU8(z['ppt/presentation.xml']).match(/<p:sldId /g)).toHaveLength(2)
    expect(strFromU8(z['[Content_Types].xml'])).toContain('/ppt/slides/slide2.xml')
    expect(strFromU8(z['ppt/slides/slide2.xml'])).toContain('<a:t>Title</a:t>')
    expect(strFromU8(z['ppt/slides/_rels/slide1.xml.rels'])).toContain('../media/page1.jpg')
  })
})
