// Name tags in Minecraft's own font: its ASCII glyph sheet (128 by 128, one
// 8 by 8 cell per character, white on transparent), embedded below. Glyphs
// are as wide as their rightmost pixel and 1 pixel apart; row 7 of a cell is
// the descender. A tag is the text on a translucent dark box, as in game.

const SHEET =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACAAQMAAAD58POIAAAABlBMVEX///////9VfPVsAAAAAXRSTlMAQObYZgAAAtJJREFUeNrtk6GPG1cQxj90eqBSnoIWVPKoCgg02qtK7oECwyXlBgcMH+vCAQWjolWRoVUVWEUGBQUBgYaBkUL2L4gWXQZEt5l5jq3bVZILDMjn2efVb3+aefukxffMwruGhJh4B0sooO0aTikRgGgAypHAtLuAJtPGABQKKkZIBwduJFiaYdUhpTNg2JQNiP2WeboDWDLlXOlSc/YRnCFrkeecRAQgJMGWQlgNHESYk1LAnpZLCUPMLcCIEUdKQYOQBJ9JBCER80kiQJqArJpDtllr5gim2TY8eciDait9EBbJaMXCzJJCx6+Pgj90YOn7rabQ834v+E/MNKEYshX8cwGlh+CFWAqQE2DxKZylz6JlCmax562KR3vuCfAOZEvTBE7UmGE9HBBFAwKwSCgGERPhDJq9UOJYQCdi4LUQfwQbyeRdSPvQA/MoGIyAJZgDs6PkoKw4AeRD3thuDxw6fjVkIBxlK0mOHHa8FwFaYVF/9/DyBMTCyfGOpRhDbttyXJ15+XIKQMYlCSXEfDsBidMWOGwObS8eNQDguD1y8vOQyEzwqZwN7EnoZAwth2QH1LTpBDjwQC21EpSYC7js5NvNEogTsAKeT0ACCJ7Jwc6NLwMFdgDmUsl6jWlih5Jn3Xngx5vVCqfkdWmJ7hlwSXhoDIOD0uPx/PTbm6qqaqCurSpA/v19CoqhNfSuvr+r1Y23xaiu6qurs6F6d2/G3f296rlHbVUDqNyYAO8xBZUVnKD8PgsW9fXNu/F6fDdejOUSsAIW4+h1fWOPi4HiVKWBL4+DUpVdhkcMT8ZPAKvFwv4mRvXAGMfxZrG4GUe17QxPfEjtl7/EV4Jpfvl5Bn5NM/Anz8BfOgN/82M9/i9T5qEUf4jAGvjRF7wnoqeRbjsg9p0C0JieRmwddKQnI0bFujKQ9NQjRtyiQtcNbqC4WwAN4Iaqxg6eJc6JDz6OD74blGMNvZoZAAAAAElFTkSuQmCC'

interface Glyph {
  width: number
  pixels: [number, number][]
}

let font: Promise<Map<number, Glyph>> | undefined

// load reads the glyphs from the sheet, once.
function load(): Promise<Map<number, Glyph>> {
  font ??= (async () => {
    const img = new Image()
    img.src = SHEET
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0)
    const data = g.getImageData(0, 0, 128, 128).data
    const glyphs = new Map<number, Glyph>()
    for (let code = 32; code < 127; code++) {
      const cx = (code % 16) * 8
      const cy = Math.floor(code / 16) * 8
      const pixels: [number, number][] = []
      let width = 0
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (data[((cy + y) * 128 + cx + x) * 4 + 3]! > 0) {
            pixels.push([x, y])
            width = Math.max(width, x + 1)
          }
        }
      }
      // A space has no pixels: the game gives it 3.
      glyphs.set(code, { width: code === 32 ? 3 : width, pixels })
    }
    return glyphs
  })()
  return font
}

// The box round the text, in font pixels: 1 to each side and above; the
// descender row is the bottom.
const PAD_X = 1
const PAD_TOP = 1
const ROWS = 8

// FONT_ROWS is how tall a tag is, in font pixels.
export const FONT_ROWS = ROWS + PAD_TOP

// drawText draws text in Minecraft's font on a canvas, each font pixel
// scale device pixels square so it stays sharp. Characters the sheet does
// not have are drawn as '?'. color and background are CSS colours.
export async function drawText(canvas: HTMLCanvasElement, text: string, scale: number, color: string, background: string): Promise<void> {
  const glyphs = await load()
  const chars = [...text].map((ch) => glyphs.get(ch.codePointAt(0)!) ?? glyphs.get(63)!)
  const width = chars.reduce((w, g) => w + g.width + 1, 0) - (chars.length ? 1 : 0)
  canvas.width = (width + PAD_X * 2) * scale
  canvas.height = FONT_ROWS * scale
  const g = canvas.getContext('2d')
  if (!g) return
  g.fillStyle = background
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = color
  let x = PAD_X
  for (const glyph of chars) {
    for (const [px, py] of glyph.pixels) g.fillRect((x + px) * scale, (PAD_TOP + py) * scale, scale, scale)
    x += glyph.width + 1
  }
}
