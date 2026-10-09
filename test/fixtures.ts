// The inputs bedrock-skin-go's fixtures were drawn from: the same textures,
// pixel for pixel, as tools/parity makes them, and helpers to compare
// against its output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect } from 'vitest'
import { parseGeometry, type Geometry } from '../src/geometry'
import { newImage, type RgbaImage } from '../src/image'
import { decodePNG, encodePNG } from '../src/png'

export const DIR = 'testdata/parity'

export const read = (name: string): Uint8Array => readFileSync(`${DIR}/${name}`)

export const parsed = (name: string): Geometry[] => parseGeometry(read(name))

function fromFn(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): RgbaImage {
  const img = newImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) img.data.set(f(x, y).map((v) => v & 0xff), (y * w + x) * 4)
  }
  return img
}

// testTexture is the procedural texture the Go tests use: red by x, green
// by y.
export const testTexture = () => fromFn(64, 64, (x, y) => [x * 4, y * 4, 128, 255])

// armorTexture is an armor layer, 64x32 as the game's are, with a
// transparent patch where real chestplates leave the lower arm bare.
export const armorTexture = (tint: number) =>
  fromFn(64, 32, (x, y) => [tint, 120 + x * 2, 140 + y * 3, x >= 40 && x < 56 && y >= 26 ? 0 : 255])

// itemTexture is an item sprite of side n: a diagonal blade whose alpha
// sweeps every value, to pin the held item's alpha cut-off.
export const itemTexture = (n: number) =>
  fromFn(n, n, (x, y) => {
    const d = x + y - (n - 1)
    if (d < -1 || d > 1) return [0, 0, 0, 0]
    return [x * 16, 200 - y * 5, 60 + d * 50, (x * 37 + y * 11) % 256]
  })

export const semiTexture = () => fromFn(64, 64, (x, y) => [x * 4 + 3, 255 - y * 4, x * y, (x * 7 + y * 13) % 256])

export const customTexture = () => fromFn(128, 128, (x, y) => [x * 2, y * 2, x ^ y, x >= 96 ? 0 : 255])

export const legacyTexture = () => fromFn(64, 32, (x, y) => [x * 4, y * 8, 60, 255])

export const faceTexture = () =>
  fromFn(32, 64, (x, y) => [x * 8, y * 4, 200, y >= 16 && y < 32 ? (x * y * 5) % 256 : 255])

export function bench(): { texture: RgbaImage; geometry: Geometry[] } {
  return {
    texture: decodePNG(readFileSync('testdata/bench-skin/texture.png')),
    geometry: parseGeometry(readFileSync('testdata/bench-skin/geometry.json')),
  }
}

// sameImage checks got against a PNG Go wrote. On a difference it saves the
// port's image in test-output/, to compare by eye.
export function sameImage(name: string, got: RgbaImage, wantPNG: Uint8Array): void {
  const want = decodePNG(wantPNG)
  expect([got.width, got.height], `${name}: size`).toEqual([want.width, want.height])
  let differing = 0
  let worst = 0
  for (let i = 0; i < got.data.length; i += 4) {
    let d = 0
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(got.data[i + k]! - want.data[i + k]!))
    if (d > 0) differing++
    worst = Math.max(worst, d)
  }
  if (differing > 0) {
    mkdirSync('test-output', { recursive: true })
    writeFileSync(`test-output/${name}.png`, encodePNG(got))
  }
  expect(differing, `${name}: ${differing} pixels differ from the Go render, worst by ${worst} (the port's is in test-output/)`).toBe(0)
}
