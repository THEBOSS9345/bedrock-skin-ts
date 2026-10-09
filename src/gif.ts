// Looping animated GIFs of rendered frames.
//
// GIF holds 256 colours a frame, so the frames share a palette of the colours
// they use most (exact for most skins, which use fewer), and transparency is
// on or off per pixel, as the renderer's alpha test already makes it. The
// palette and the colour each pixel gets are the Go version's; the LZW bytes
// are this encoder's own, so the file decodes to the same pixels without
// being the same bytes.

import * as gomath from './gomath'
import type { RgbaImage } from './image'

// encodeGIF writes frames as a looping GIF at fps frames a second. Every
// frame must be the size of the first.
export function encodeGIF(frames: readonly RgbaImage[], fps: number): Uint8Array {
  const first = frames[0]
  if (!first) throw new RangeError('encodeGIF: no frames')
  const { width: w, height: h } = first
  const palette = gifPalette(frames)
  const delay = Math.max(gomath.round(100 / fps), 2) // hundredths of a second

  // The colour table's size is a power of two, at least 2.
  let bits = 1
  while (1 << bits < palette.length) bits++
  const out = new ByteWriter()
  out.ascii('GIF89a')
  out.u16(w)
  out.u16(h)
  out.byte(0x80 | 0x70 | (bits - 1)) // a global colour table, 8 bits a channel
  out.byte(0) // background: index 0, transparent
  out.byte(0) // no aspect ratio
  for (let i = 0; i < 1 << bits; i++) {
    const c = palette[i] ?? 0
    out.byte((c >> 16) & 0xff)
    out.byte((c >> 8) & 0xff)
    out.byte(c & 0xff)
  }
  if (frames.length > 1) {
    // NETSCAPE2.0: loop forever.
    out.byte(0x21)
    out.byte(0xff)
    out.byte(11)
    out.ascii('NETSCAPE2.0')
    out.byte(3)
    out.byte(1)
    out.u16(0)
    out.byte(0)
  }
  const indexOf = new Map<number, number>()
  const indices = new Uint8Array(w * h)
  for (const f of frames) {
    if (f.width !== w || f.height !== h) throw new RangeError('encodeGIF: frames differ in size')
    const d = f.data
    for (let p = 0; p < w * h; p++) {
      if (d[p * 4 + 3]! < 128) {
        indices[p] = 0
        continue
      }
      const key = (d[p * 4]! << 16) | (d[p * 4 + 1]! << 8) | d[p * 4 + 2]!
      let i = indexOf.get(key)
      if (i === undefined) {
        i = paletteIndex(palette, key)
        indexOf.set(key, i)
      }
      indices[p] = i
    }
    // Graphic control: dispose to background, index 0 transparent.
    out.byte(0x21)
    out.byte(0xf9)
    out.byte(4)
    out.byte((2 << 2) | 1)
    out.u16(delay)
    out.byte(0)
    out.byte(0)
    // The image, the whole canvas, no local colour table.
    out.byte(0x2c)
    out.u16(0)
    out.u16(0)
    out.u16(w)
    out.u16(h)
    out.byte(0)
    const minCode = Math.max(bits, 2)
    out.byte(minCode)
    const data = lzw(indices, minCode)
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i)
      out.byte(n)
      out.bytes(data.subarray(i, i + n))
    }
    out.byte(0)
  }
  out.byte(0x3b)
  return out.result()
}

// gifPalette is index 0 transparent, then up to 255 opaque colours: every
// colour the frames use when they fit, otherwise the most used, each of the
// rest drawn as its nearest. Colours are 0xRRGGBB; index 0 is black.
function gifPalette(frames: readonly RgbaImage[]): number[] {
  const count = new Map<number, number>()
  for (const f of frames) {
    const d = f.data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! >= 128) {
        const key = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!
        count.set(key, (count.get(key) ?? 0) + 1)
      }
    }
  }
  const cols = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a - b)
  const pal = [-1, ...cols.slice(0, 255)] // -1: the transparent entry
  if (pal.length === 1) pal.push(0)
  return pal.map((c, i) => (i === 0 ? 0 : c))
}

// paletteIndex is Go's color.Palette.Index for an opaque colour: the nearest
// entry by squared distance of the 16-bit premultiplied channels, as its
// wrapping uint32 arithmetic has it. Entry 0 is transparent black.
function paletteIndex(pal: number[], c: number): number {
  const ch = (v: number, a: number) => Math.floor(((v | (v << 8)) * a) / 0xff)
  const rgba = (c: number, a: number) => [ch((c >> 16) & 0xff, a), ch((c >> 8) & 0xff, a), ch(c & 0xff, a), a | (a << 8)]
  const sqDiff = (x: number, y: number) => {
    const d = (x - y) >>> 0
    return (Math.imul(d, d) >>> 0) >>> 2
  }
  const cc = rgba(c, 255)
  let ret = 0
  let best = 0xffffffff
  for (let i = 0; i < pal.length; i++) {
    const vv = rgba(pal[i]!, i === 0 ? 0 : 255)
    const sum = (sqDiff(cc[0]!, vv[0]!) + sqDiff(cc[1]!, vv[1]!) + sqDiff(cc[2]!, vv[2]!) + sqDiff(cc[3]!, vv[3]!)) >>> 0
    if (sum < best) {
      if (sum === 0) return i
      ret = i
      best = sum
    }
  }
  return ret
}

// lzw compresses indices as GIF's variable-width LZW, starting with a clear
// code and clearing again whenever the 4096-entry table fills.
function lzw(indices: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode
  const end = clear + 1
  const out = new ByteWriter()
  let acc = 0
  let accBits = 0
  let width = minCode + 1
  const emit = (code: number) => {
    acc |= code << accBits
    accBits += width
    while (accBits >= 8) {
      out.byte(acc & 0xff)
      acc >>>= 8
      accBits -= 8
    }
  }
  let table = new Map<number, number>()
  let next = end + 1
  emit(clear)
  let prefix = -1
  for (const k of indices) {
    if (prefix < 0) {
      prefix = k
      continue
    }
    const key = (prefix << 8) | k
    const found = table.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    if (next === 4096) {
      emit(clear)
      table = new Map()
      next = end + 1
      width = minCode + 1
    } else {
      table.set(key, next)
      // The decoder widens its codes once the table reaches the next power
      // of two; it learns each entry one code behind, so widen as it would.
      if (next === 1 << width && width < 12) width++
      next++
    }
    prefix = k
  }
  if (prefix >= 0) emit(prefix)
  emit(end)
  if (accBits > 0) out.byte(acc & 0xff)
  return out.result()
}

class ByteWriter {
  private buf = new Uint8Array(1024)
  private n = 0

  byte(b: number): void {
    if (this.n === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2)
      grown.set(this.buf)
      this.buf = grown
    }
    this.buf[this.n++] = b
  }

  bytes(b: Uint8Array): void {
    for (const x of b) this.byte(x)
  }

  u16(v: number): void {
    this.byte(v & 0xff)
    this.byte((v >> 8) & 0xff)
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i))
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.n)
  }
}
