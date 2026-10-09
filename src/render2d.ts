// The flat fallback for geometry whose bones draw nothing. See
// docs/rendering-pipeline.md#the-2d-fallback in bedrock-skin-go.

import { newImage, type RgbaImage } from './image'
import { boxUVRects } from './mesh'
import type { View } from './view'

// Nrgba is a non-premultiplied RGBA image with its own size, as Go's
// *image.NRGBA with a zero origin.
interface Nrgba {
  w: number
  h: number
  pix: Uint8Array
}

const nrgba = (w: number, h: number): Nrgba => ({ w, h, pix: new Uint8Array(w * h * 4) })

// premultiply is color.NRGBA's RGBA(): premultiplied, 16 bits a channel.
function premultiply(c: Uint8Array, i: number): [number, number, number, number] {
  const a = c[i + 3]!
  const ch = (v: number) => Math.floor(((v | (v << 8)) * a) / 0xff)
  return [ch(c[i]!), ch(c[i + 1]!), ch(c[i + 2]!), a | (a << 8)]
}

// unpremultiply is Go's NRGBA SetRGBA64: back to straight alpha, 8 bits a
// channel.
function unpremultiply(c: [number, number, number, number]): [number, number, number, number] {
  let [r, g, b] = c
  const a = c[3]
  if (a !== 0 && a !== 0xffff) {
    r = Math.floor((r * 0xffff) / a)
    g = Math.floor((g * 0xffff) / a)
    b = Math.floor((b * 0xffff) / a)
  }
  return [(r >> 8) & 0xff, (g >> 8) & 0xff, (b >> 8) & 0xff, (a >> 8) & 0xff]
}

// over is Go's draw.Over of one premultiplied pixel onto another.
function over(dst: number[], src: number[]): [number, number, number, number] {
  const a = 0xffff - src[3]!
  const ch = (i: number) => (Math.floor((dst[i]! * a) / 0xffff) + src[i]!) & 0xffff
  return [ch(0), ch(1), ch(2), ch(3)]
}

// render2D composites a flat front-view "paper doll" by cropping the
// standard vanilla box-UV regions straight out of the texture. It needs no
// geometry at all, which is why rendering falls back to it for geometry that
// draws nothing: bones with neither cubes nor a poly mesh. Coordinates are
// against a 64-wide texture, scaled for other widths.
export function render2D(texture: RgbaImage, view: View, size: number): RgbaImage {
  const scale = texture.width / 64.0
  const tex: Nrgba = { w: texture.width, h: texture.height, pix: Uint8Array.from(texture.data) }

  const front = (ux: number, uy: number, w: number, h: number, d: number): Nrgba => {
    const r = boxUVRects(ux * scale, uy * scale, w * scale, h * scale, d * scale)[2]![1] // north
    return crop(tex, Math.trunc(r.x), Math.trunc(r.y), Math.trunc(r.x + r.w), Math.trunc(r.y + r.h))
  }
  const head = front(0, 0, 8, 8, 8)
  const body = front(16, 16, 8, 12, 4)
  const rightArm = front(40, 16, 4, 12, 4)
  const leftArm = front(32, 48, 4, 12, 4)
  const rightLeg = front(0, 16, 4, 12, 4)
  const leftLeg = front(16, 48, 4, 12, 4)

  const canvas =
    view === 'head' || view === 'avatar'
      ? head
      : view === 'chest'
        ? composeParts(head, body, rightArm, leftArm)
        : composeParts(head, body, rightArm, leftArm, [rightLeg, leftLeg])

  const out = newImage(size, size)
  if (canvas.w === 0 || canvas.h === 0 || size === 0) return out
  // Nearest neighbour, as x/image/draw scales: the source pixel under each
  // destination pixel's centre. Drawn over a clear image, every pixel ends
  // up premultiplied and back.
  const d = out.data
  for (let dy = 0; dy < size; dy++) {
    const sy = Math.floor(((2 * dy + 1) * canvas.h) / (size * 2))
    for (let dx = 0; dx < size; dx++) {
      const sx = Math.floor(((2 * dx + 1) * canvas.w) / (size * 2))
      const p = unpremultiply(premultiply(canvas.pix, (sy * canvas.w + sx) * 4))
      d.set(p, (dy * size + dx) * 4)
    }
  }
  return out
}

// crop is the rectangle's part of the image, as Go's SubImage: clipped to it.
function crop(img: Nrgba, x0: number, y0: number, x1: number, y1: number): Nrgba {
  ;[x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)]
  ;[y0, y1] = [Math.min(y0, y1), Math.max(y0, y1)]
  x0 = Math.max(x0, 0)
  y0 = Math.max(y0, 0)
  x1 = Math.min(x1, img.w)
  y1 = Math.min(y1, img.h)
  if (x0 >= x1 || y0 >= y1) return nrgba(0, 0)
  const w = x1 - x0
  const h = y1 - y0
  const out = nrgba(w, h)
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.w + x0) * 4
    out.pix.set(img.pix.subarray(src, src + w * 4), y * w * 4)
  }
  return out
}

// drawOver draws src over dst with its top-left corner at (x, y), clipped
// to dst.
function drawOver(dst: Nrgba, src: Nrgba, x: number, y: number): void {
  for (let sy = 0; sy < src.h; sy++) {
    for (let sx = 0; sx < src.w; sx++) {
      const dx = x + sx
      const dy = y + sy
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue
      const i = (dy * dst.w + dx) * 4
      dst.pix.set(unpremultiply(over(premultiply(dst.pix, i), premultiply(src.pix, (sy * src.w + sx) * 4))), i)
    }
  }
}

// composeParts stacks head above body above arms and legs into a flat paper
// doll, as seen facing the player: their right arm and leg on the viewer's
// left.
function composeParts(head: Nrgba, body: Nrgba, viewerLeftArm: Nrgba, viewerRightArm: Nrgba, legs?: [Nrgba, Nrgba]): Nrgba {
  const bw = body.w
  const totalW = viewerLeftArm.w + body.w + viewerRightArm.w
  let totalH = head.h + body.h
  if (legs) totalH += legs[0].h
  const out = nrgba(totalW, totalH)
  const midX = viewerLeftArm.w
  let y = 0
  // Go's integer division rounds toward zero.
  drawOver(out, head, midX + Math.trunc((bw - head.w) / 2), y)
  y += head.h
  drawOver(out, viewerLeftArm, 0, y)
  drawOver(out, body, midX, y)
  drawOver(out, viewerRightArm, midX + bw, y)
  y += body.h
  if (legs) {
    const [leftLeg, rightLeg] = legs
    drawOver(out, leftLeg, midX + Math.trunc(bw / 2) - leftLeg.w, y)
    drawOver(out, rightLeg, midX + Math.trunc(bw / 2), y)
  }
  return out
}
