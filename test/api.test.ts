import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as api from '../src/index'
import { armorTexture, itemTexture, testTexture } from './fixtures'

interface GifFrame {
  delay: number
  rgba: Uint8Array // transparent pixels are all zero
}

// decodeGIF reads what encodeGIF writes: a global colour table, a graphic
// control block and a full-canvas image a frame. It checks the encoder's
// LZW against a separately written decoder.
function decodeGIF(b: Uint8Array): { width: number; height: number; loops: boolean; frames: GifFrame[] } {
  let p = 0
  const u8 = () => b[p++]!
  const u16 = () => u8() | (u8() << 8)
  expect(new TextDecoder().decode(b.subarray(0, 6))).toBe('GIF89a')
  p = 6
  const width = u16()
  const height = u16()
  const packed = u8()
  p += 2
  const tableSize = 1 << ((packed & 7) + 1)
  const table = b.subarray(p, p + tableSize * 3)
  p += tableSize * 3
  let loops = false
  let delay = 0
  let transparent = -1
  const frames: GifFrame[] = []
  for (;;) {
    const kind = u8()
    if (kind === 0x3b) break
    if (kind === 0x21) {
      const label = u8()
      if (label === 0xff) loops = true
      if (label === 0xf9) {
        u8()
        const flags = u8()
        delay = u16()
        const t = u8()
        transparent = flags & 1 ? t : -1
        u8()
        continue
      }
      for (let n = u8(); n !== 0; n = u8()) p += n
      continue
    }
    expect(kind).toBe(0x2c)
    p += 8
    expect(u8() & 0x80).toBe(0)
    const minCode = u8()
    const data: number[] = []
    for (let n = u8(); n !== 0; n = u8()) for (let i = 0; i < n; i++) data.push(u8())
    const indices = lzwDecode(data, minCode, width * height)
    const rgba = new Uint8Array(width * height * 4)
    indices.forEach((ix, i) => {
      if (ix === transparent) return
      rgba.set([table[ix * 3]!, table[ix * 3 + 1]!, table[ix * 3 + 2]!, 255], i * 4)
    })
    frames.push({ delay, rgba })
  }
  return { width, height, loops, frames }
}

function lzwDecode(data: number[], minCode: number, want: number): number[] {
  const clear = 1 << minCode
  const end = clear + 1
  let width = minCode + 1
  let dict: number[][] = []
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => [i])
    width = minCode + 1
  }
  reset()
  const out: number[] = []
  let bit = 0
  let prev: number[] | undefined
  for (;;) {
    let code = 0
    for (let i = 0; i < width; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i
    if (code === clear) {
      reset()
      prev = undefined
      continue
    }
    if (code === end) break
    let entry: number[]
    if (code < dict.length) entry = dict[code]!
    else if (code === dict.length && prev) entry = [...prev, prev[0]!]
    else throw new Error(`bad LZW code ${code}`)
    out.push(...entry)
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]!])
      if (dict.length === 1 << width && width < 12) width++
    }
    prev = entry
  }
  expect(out.length).toBe(want)
  return out
}

describe('GIF', () => {
  it('round-trips the frames', () => {
    // Few enough colours for the palette to hold them all exactly.
    const tex = api.newImage(64, 64)
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) tex.data.set([((x / 16) | 0) * 60, ((y / 16) | 0) * 60, 90, 255], (y * 64 + x) * 4)
    const opts: api.AnimationOptions = { texture: tex, size: 48, animation: api.Motion.walk, fps: 8 }
    const frames = api.renderFrames(opts)
    const gif = decodeGIF(api.renderGIF(opts))
    expect([gif.width, gif.height, gif.loops, gif.frames.length]).toEqual([48, 48, true, frames.length])
    gif.frames.forEach((f, n) => {
      expect(f.delay).toBe(13)
      const want = frames[n]!.data
      for (let i = 0; i < f.rgba.length; i += 4) {
        if (want[i + 3]! >= 128) expect([...f.rgba.subarray(i, i + 3)]).toEqual([...want.subarray(i, i + 3)])
        else expect(f.rgba[i + 3]).toBe(0)
      }
    })
  })

  it('keeps the nearest colour when there are more than 255', () => {
    // Every pixel a different colour: 255 fit the palette, the rest are drawn
    // as their nearest.
    const img = api.newImage(64, 64)
    for (let i = 0; i < 64 * 64; i++) img.data.set([i & 0xff, (i >> 4) & 0xff, (i * 7) & 0xff, 255], i * 4)
    const gif = decodeGIF(api.encodeGIF([img], 10))
    expect(gif.loops).toBe(false)
    let exact = 0
    for (let i = 0; i < img.data.length; i += 4) {
      if ([0, 1, 2].every((k) => gif.frames[0]!.rgba[i + k] === img.data[i + k])) exact++
    }
    expect(exact).toBe(255)
  })

  it('compresses noise past a full LZW table', () => {
    // Noise in 200 colours: enough codes to fill the table several times.
    const img = api.newImage(256, 256)
    let seed = 1
    for (let i = 0; i < 256 * 256; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      const c = (seed >>> 16) % 200
      img.data.set([c, 255 - c, (c * 3) & 0xff, c % 7 === 0 ? 0 : 255], i * 4)
    }
    const gif = decodeGIF(api.encodeGIF([img, img], 10))
    for (const f of gif.frames) {
      for (let i = 0; i < img.data.length; i += 4) {
        const want = img.data[i + 3] === 0 ? [0, 0, 0, 0] : [...img.data.subarray(i, i + 4)]
        if (f.rgba[i] !== want[0] || f.rgba[i + 1] !== want[1] || f.rgba[i + 3] !== want[3]) {
          throw new Error(`pixel ${i / 4}: got ${[...f.rgba.subarray(i, i + 4)]}, want ${want}`)
        }
      }
    }
  })

  it('spins an item', () => {
    const gif = decodeGIF(api.renderItemGIF({ item: itemTexture(16), size: 32, fps: 4, duration: 1 }))
    expect(gif.frames.length).toBe(4)
    expect(gif.frames[0]!.delay).toBe(25)
  })
})

describe('bytes', () => {
  const skin = api.encodePNG(testTexture())

  it('renders from encoded files the same as from images', () => {
    const fromImage = api.renderPNG({ texture: testTexture(), view: 'avatar', size: 64 })
    expect(api.renderBytes({ texture: skin, geometry: 'null', view: 'avatar', size: 64 })).toEqual(fromImage)
    const golden = api.decodeImage(readFileSync('testdata/golden/avatar.png'))
    expect(Buffer.from(api.decodeImage(api.renderBytes({ texture: skin, view: 'avatar', size: 96 })).data)).toEqual(Buffer.from(golden.data))
  })

  it('decodes armor and items', () => {
    const layer1 = api.encodePNG(armorTexture(40))
    const layer2 = api.encodePNG(armorTexture(150))
    const sword = api.encodePNG(itemTexture(16))
    const got = api.renderBytes({ texture: skin, armor: api.armorBytesSet(layer1, layer2), rightHand: { item: sword }, angle: 'iso', size: 64 })
    const want = api.renderPNG({
      texture: testTexture(),
      armor: api.armorSet(armorTexture(40), armorTexture(150)),
      rightHand: { item: itemTexture(16) },
      angle: 'iso',
      size: 64,
    })
    expect(got).toEqual(want)
    expect(api.renderItemBytes({ item: sword, size: 32 })).toEqual(api.renderItemPNG({ item: itemTexture(16), size: 32 }))
    expect(api.imageDimensions(sword)).toEqual({ width: 16, height: 16 })
  })

  it('renders animations from encoded files', () => {
    const pngs = api.renderFramesPNG({ texture: skin, size: 32, animation: api.Motion.wave, fps: 4 })
    expect(pngs.length).toBe(4)
    expect(decodeGIF(api.renderGIFBytes({ texture: skin, size: 32, animation: api.Motion.wave, fps: 4 })).frames.length).toBe(4)
  })

  it('names the input it cannot read', () => {
    const code = (f: () => unknown) => {
      try {
        f()
      } catch (e) {
        return e instanceof api.SkinError ? `${e.code}: ${e.message}` : String(e)
      }
      return 'ok'
    }
    expect(code(() => api.renderBytes({}))).toMatch(/^NO_TEXTURE/)
    expect(code(() => api.renderBytes({ texture: new Uint8Array([1, 2, 3]) }))).toMatch(/^IMAGE: bedrock-skin: texture: not a valid image/)
    expect(code(() => api.renderBytes({ texture: skin, cape: new Uint8Array([0xff, 0xd8, 0xff, 0]) }))).toMatch(/cape: .*JPEG/)
    expect(code(() => api.renderBytes({ texture: skin, geometry: '{nope' }))).toMatch(/^JSON/)
    expect(code(() => api.renderBytes({ hideSkin: true, armor: { helmet: new Uint8Array([9]) } }))).toMatch(/armor helmet/)
    expect(code(() => api.decodeImage(new Uint8Array()))).toMatch(/no image data/)
  })
})

describe('the package', () => {
  it('exports the whole API', () => {
    for (const name of ['render', 'renderPNG', 'renderGIF', 'prepareFrames', 'parseAnimations', 'Skin', 'parseGeometryTree', 'decodeWireSkin', 'Motion']) {
      expect(api, name).toHaveProperty(name)
    }
    expect(api.exampleAnimations().size).toBe(33)
  })
})
