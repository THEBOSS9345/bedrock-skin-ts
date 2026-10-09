// PNG reading and writing, in plain JavaScript so it runs the same in a
// browser, Node, Deno, Bun and a worker. fflate does the compression.
//
// Reading takes every PNG there is - each colour type and bit depth, a
// palette with transparency, interlacing - and gives 8-bit RGBA, as Go's
// image/png decoder reads a file and the library then draws it: 16-bit
// channels keep their high byte. Writing makes 8-bit RGBA, or RGB when every
// pixel is opaque, as Go's encoder does.

import { unzlibSync, zlibSync } from 'fflate'
import { SkinError } from './errors'
import { newImage, type RgbaImage } from './image'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const isPNG = (b: Uint8Array) => b.length >= 8 && SIGNATURE.every((v, i) => b[i] === v)

function bad(why: string): never {
  throw new SkinError('IMAGE', `not a valid image: ${why}`)
}

const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0

interface Header {
  width: number
  height: number
  depth: number
  colorType: number
  interlace: number
}

function readHeader(b: Uint8Array): Header {
  if (!isPNG(b)) bad('not a PNG')
  if (b.length < 33 || u32(b, 12) !== 0x49484452) bad('PNG has no IHDR')
  const h: Header = { width: u32(b, 16), height: u32(b, 20), depth: b[24]!, colorType: b[25]!, interlace: b[28]! }
  if (h.width === 0 || h.height === 0) bad('PNG has no pixels')
  const ok: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
  if (!ok[h.colorType]?.includes(h.depth)) bad(`PNG colour type ${h.colorType} at depth ${h.depth}`)
  if (b[26] !== 0 || b[27] !== 0 || h.interlace > 1) bad('PNG compression, filter or interlace method')
  return h
}

// pngDimensions reads a PNG's size from its header, without decoding the
// pixels: the check to make before decoding an untrusted upload, which can
// declare enormous dimensions in a few bytes.
export function pngDimensions(data: Uint8Array): { width: number; height: number } {
  const h = readHeader(data)
  return { width: h.width, height: h.height }
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function decodePNG(data: Uint8Array): RgbaImage {
  const h = readHeader(data)
  const idat: Uint8Array[] = []
  let palette: Uint8Array | undefined
  let trns: Uint8Array | undefined
  for (let i = 8; i + 8 <= data.length; ) {
    const len = u32(data, i)
    const type = String.fromCharCode(data[i + 4]!, data[i + 5]!, data[i + 6]!, data[i + 7]!)
    const body = data.subarray(i + 8, i + 8 + len)
    if (body.length !== len) bad('PNG chunk runs past the end')
    if (type === 'IDAT') idat.push(body)
    else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') trns = body
    else if (type === 'IEND') break
    i += 12 + len
  }
  if (idat.length === 0) bad('PNG has no image data')
  if (h.colorType === 3 && !palette) bad('PNG has no palette')
  let raw: Uint8Array
  try {
    raw = unzlibSync(idat.length === 1 ? idat[0]! : concat(idat))
  } catch {
    bad('PNG data does not decompress')
  }

  const img = newImage(h.width, h.height)
  const channels = CHANNELS[h.colorType]!
  const bitsPerPixel = channels * h.depth
  const bpp = Math.max(1, bitsPerPixel >> 3) // bytes a pixel, for the filters
  let pos = 0
  const pass = (x0: number, y0: number, dx: number, dy: number) => {
    const w = Math.ceil((h.width - x0) / dx)
    const rows = Math.ceil((h.height - y0) / dy)
    if (w <= 0 || rows <= 0) return
    const stride = Math.ceil((w * bitsPerPixel) / 8)
    let prev = new Uint8Array(stride)
    for (let r = 0; r < rows; r++) {
      if (pos + 1 + stride > raw.length) bad('PNG data is short')
      const filter = raw[pos]!
      const line = raw.slice(pos + 1, pos + 1 + stride)
      pos += 1 + stride
      unfilter(filter, line, prev, bpp)
      writeRow(img, h, line, w, x0, y0 + r * dy, dx, palette, trns)
      prev = line
    }
  }
  if (h.interlace === 1) {
    // Adam7.
    pass(0, 0, 8, 8)
    pass(4, 0, 8, 8)
    pass(0, 4, 4, 8)
    pass(2, 0, 4, 4)
    pass(0, 2, 2, 4)
    pass(1, 0, 2, 2)
    pass(0, 1, 1, 2)
  } else {
    pass(0, 0, 1, 1)
  }
  return img
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = line.length
  switch (filter) {
    case 0:
      return
    case 1: // sub
      for (let i = bpp; i < n; i++) line[i] = (line[i]! + line[i - bpp]!) & 0xff
      return
    case 2: // up
      for (let i = 0; i < n; i++) line[i] = (line[i]! + prev[i]!) & 0xff
      return
    case 3: // average
      for (let i = 0; i < n; i++) line[i] = (line[i]! + (((i >= bpp ? line[i - bpp]! : 0) + prev[i]!) >> 1)) & 0xff
      return
    case 4: // Paeth
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0
        const b = prev[i]!
        const c = i >= bpp ? prev[i - bpp]! : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      return
  }
  bad(`PNG filter ${filter}`)
}

// writeRow converts one row of w pixels to RGBA at (x0 + k*dx, y).
function writeRow(
  img: RgbaImage & { data: Uint8ClampedArray },
  h: Header,
  line: Uint8Array,
  w: number,
  x0: number,
  y: number,
  dx: number,
  palette: Uint8Array | undefined,
  trns: Uint8Array | undefined,
): void {
  const d = img.data
  const depth = h.depth
  // A sample at depth < 8, scaled to a byte as Go's decoder scales it.
  const small = (k: number): number => {
    const bit = k * depth
    const v = (line[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
    return v
  }
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
  for (let k = 0; k < w; k++) {
    const o = (y * img.width + x0 + k * dx) * 4
    let r: number, g: number, b: number
    let a = 255
    switch (h.colorType) {
      case 0: {
        // Grey; tRNS names one grey as transparent.
        const raw = depth < 8 ? small(k) : depth === 8 ? line[k]! : (line[k * 2]! << 8) | line[k * 2 + 1]!
        r = g = b = depth < 8 ? raw * scale : depth === 8 ? raw : raw >> 8
        if (trns && trns.length >= 2 && raw === ((trns[0]! << 8) | trns[1]!)) a = 0
        break
      }
      case 2: {
        if (depth === 8) {
          r = line[k * 3]!
          g = line[k * 3 + 1]!
          b = line[k * 3 + 2]!
          if (trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5] && trns[0] === 0 && trns[2] === 0 && trns[4] === 0) a = 0
        } else {
          const i = k * 6
          const rr = (line[i]! << 8) | line[i + 1]!
          const gg = (line[i + 2]! << 8) | line[i + 3]!
          const bb = (line[i + 4]! << 8) | line[i + 5]!
          r = rr >> 8
          g = gg >> 8
          b = bb >> 8
          if (trns && trns.length >= 6 && rr === ((trns[0]! << 8) | trns[1]!) && gg === ((trns[2]! << 8) | trns[3]!) && bb === ((trns[4]! << 8) | trns[5]!)) a = 0
        }
        break
      }
      case 3: {
        const idx = depth < 8 ? small(k) : line[k]!
        if (idx * 3 + 2 >= palette!.length) bad('PNG palette index out of range')
        r = palette![idx * 3]!
        g = palette![idx * 3 + 1]!
        b = palette![idx * 3 + 2]!
        a = trns && idx < trns.length ? trns[idx]! : 255
        break
      }
      case 4:
        if (depth === 8) {
          r = g = b = line[k * 2]!
          a = line[k * 2 + 1]!
        } else {
          r = g = b = line[k * 4]!
          a = line[k * 4 + 2]!
        }
        break
      default: // 6
        if (depth === 8) {
          r = line[k * 4]!
          g = line[k * 4 + 1]!
          b = line[k * 4 + 2]!
          a = line[k * 4 + 3]!
        } else {
          r = line[k * 8]!
          g = line[k * 8 + 2]!
          b = line[k * 8 + 4]!
          a = line[k * 8 + 6]!
        }
    }
    d[o] = r
    d[o + 1] = g
    d[o + 2] = b
    d[o + 3] = a
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)))
  out.set(t, 4)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32([t, body]))
  return out
}

// encodePNG writes an image as an 8-bit PNG: RGB when every pixel is opaque,
// else RGBA, as Go's encoder chooses.
export function encodePNG(img: RgbaImage): Uint8Array {
  const { width, height, data } = img
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new SkinError('ENCODE', `cannot encode a ${width}x${height} image of ${data.length} bytes`)
  }
  let opaque = true
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false
      break
    }
  }
  const channels = opaque ? 3 : 4
  const stride = width * channels
  // Each row is filtered with the filter that best shrinks it (the smallest
  // sum of absolute differences), as most encoders do.
  const raw = new Uint8Array(height * (stride + 1))
  let prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  const trial = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const t = x * channels
      cur[t] = data[s]!
      cur[t + 1] = data[s + 1]!
      cur[t + 2] = data[s + 2]!
      if (!opaque) cur[t + 3] = data[s + 3]!
    }
    let bestCost = Infinity
    const o = y * (stride + 1)
    for (let f = 0; f < 5; f++) {
      let cost = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels]! : 0
        const b = prev[i]!
        const c = i >= channels ? prev[i - channels]! : 0
        let pred = 0
        if (f === 1) pred = a
        else if (f === 2) pred = b
        else if (f === 3) pred = (a + b) >> 1
        else if (f === 4) {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        }
        const v = (cur[i]! - pred) & 0xff
        trial[i] = v
        cost += v < 128 ? v : 256 - v
      }
      if (cost < bestCost) {
        bestCost = cost
        raw[o] = f
        raw.set(trial, o + 1)
      }
    }
    prev = cur.slice()
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = opaque ? 2 : 6
  return concat([
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

export { isPNG }
