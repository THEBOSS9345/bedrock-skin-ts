// The software rasterizer: a port of the parts of fauxgl the Go version draws
// with, kept to the same arithmetic in the same order so both render the
// same pixels. See docs/rendering-pipeline.md in bedrock-skin-go.
//
// Do not "simplify" the arithmetic here: reordering an addition changes the
// last bit, and the last bit moves an edge pixel.

import * as gomath from './gomath'
import { newImage, type RgbaImage } from './image'

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
export const ZERO: Vec3 = vec3(0, 0, 0)

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale3 = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export function normalize(a: Vec3): Vec3 {
  const r = 1.0 / Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
  return vec3(a.x * r, a.y * r, a.z * r)
}
export const min3 = (a: Vec3, b: Vec3): Vec3 => vec3(gomath.min(a.x, b.x), gomath.min(a.y, b.y), gomath.min(a.z, b.z))
export const max3 = (a: Vec3, b: Vec3): Vec3 => vec3(gomath.max(a.x, b.x), gomath.max(a.y, b.y), gomath.max(a.z, b.z))

interface Vec4 {
  x: number
  y: number
  z: number
  w: number
}

const vec4 = (x: number, y: number, z: number, w: number): Vec4 => ({ x, y, z, w })
const add4 = (a: Vec4, b: Vec4): Vec4 => vec4(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w)
const sub4 = (a: Vec4, b: Vec4): Vec4 => vec4(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w)
const scale4 = (a: Vec4, s: number): Vec4 => vec4(a.x * s, a.y * s, a.z * s, a.w * s)
const div4 = (a: Vec4, s: number): Vec4 => vec4(a.x / s, a.y / s, a.z / s, a.w / s)
const dot4 = (a: Vec4, b: Vec4): number => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
const xyz = (a: Vec4): Vec3 => vec3(a.x, a.y, a.z)

// depthOutside: beyond the near or far plane, or behind the camera.
const depthOutside = (v: Vec4) => Number.isNaN(v.w) || v.w <= 0 || v.z < -v.w || v.z > v.w

// Mat4 is a 4x4 matrix, row major, as fauxgl's Matrix: m[row * 4 + col].
export type Mat4 = readonly number[]

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

export const translation = (v: Vec3): Mat4 => [1, 0, 0, v.x, 0, 1, 0, v.y, 0, 0, 1, v.z, 0, 0, 0, 1]

export const scaling = (v: Vec3): Mat4 => [v.x, 0, 0, 0, 0, v.y, 0, 0, 0, 0, v.z, 0, 0, 0, 0, 1]

// rotation is fauxgl's: about axis v by a radians, turning the opposite way
// to the standard right-handed rotation.
export function rotation(v: Vec3, a: number): Mat4 {
  v = normalize(v)
  const s = gomath.sin(a)
  const c = gomath.cos(a)
  const m = 1.0 - c
  return [
    m * v.x * v.x + c,
    m * v.x * v.y + v.z * s,
    m * v.z * v.x - v.y * s,
    0,
    m * v.x * v.y - v.z * s,
    m * v.y * v.y + c,
    m * v.y * v.z + v.x * s,
    0,
    m * v.z * v.x + v.y * s,
    m * v.y * v.z - v.x * s,
    m * v.z * v.z + c,
    0,
    0,
    0,
    0,
    1,
  ]
}

function frustum(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  const t1 = 2.0 * n
  const t2 = r - l
  const t3 = t - b
  const t4 = f - n
  return [t1 / t2, 0, (r + l) / t2, 0, 0, t1 / t3, (t + b) / t3, 0, 0, 0, (-f - n) / t4, (-t1 * f) / t4, 0, 0, -1, 0]
}

function perspectiveMatrix(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const ymax = near * gomath.tan((fovy * Math.PI) / 360.0)
  const xmax = ymax * aspect
  return frustum(-xmax, xmax, -ymax, ymax, near, far)
}

export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, center))
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  return [x.x, x.y, x.z, -dot(x, eye), y.x, y.y, y.z, -dot(y, eye), z.x, z.y, z.z, -dot(z, eye), 0, 0, 0, 1]
}

function screen(w: number, h: number): Mat4 {
  const w2 = w / 2.0
  const h2 = h / 2.0
  return [w2, 0, 0, w2, 0, -h2, 0, h2, 0, 0, 0.5, 0.5, 0, 0, 0, 1]
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const m = new Array<number>(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      m[i * 4 + j] = a[i * 4]! * b[j]! + a[i * 4 + 1]! * b[4 + j]! + a[i * 4 + 2]! * b[8 + j]! + a[i * 4 + 3]! * b[12 + j]!
    }
  }
  return m
}

// translate, scale, rotate and perspective apply their matrix after m, as
// fauxgl's methods do: the new matrix times m.
export const translate = (m: Mat4, v: Vec3): Mat4 => mul(translation(v), m)
export const scale = (m: Mat4, v: Vec3): Mat4 => mul(scaling(v), m)
export const rotate = (m: Mat4, v: Vec3, a: number): Mat4 => mul(rotation(v, a), m)
export const perspective = (m: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 =>
  mul(perspectiveMatrix(fovy, aspect, near, far), m)

export function mulPosition(a: Mat4, b: Vec3): Vec3 {
  return vec3(
    a[0]! * b.x + a[1]! * b.y + a[2]! * b.z + a[3]!,
    a[4]! * b.x + a[5]! * b.y + a[6]! * b.z + a[7]!,
    a[8]! * b.x + a[9]! * b.y + a[10]! * b.z + a[11]!,
  )
}

function mulPositionW(a: Mat4, b: Vec3): Vec4 {
  return vec4(
    a[0]! * b.x + a[1]! * b.y + a[2]! * b.z + a[3]!,
    a[4]! * b.x + a[5]! * b.y + a[6]! * b.z + a[7]!,
    a[8]! * b.x + a[9]! * b.y + a[10]! * b.z + a[11]!,
    a[12]! * b.x + a[13]! * b.y + a[14]! * b.z + a[15]!,
  )
}

// Vertex is one corner of a triangle: where it is, and its texture
// coordinate (u, v, 0).
export interface Vertex {
  readonly position: Vec3
  readonly texture: Vec3
}

export const vertex = (position: Vec3, u: number, v: number): Vertex => ({ position, texture: vec3(u, v, 0) })

export type Triangle = readonly [Vertex, Vertex, Vertex]

// A vertex once the vertex stage has run: its clip-space position too.
interface OutVertex {
  position: Vec3
  texture: Vec3
  output: Vec4
}

// interpolate3 is fauxgl's barycentric interpolation, with b.w the
// reciprocal of the weights' sum: ((0 + v1*b.x) + v2*b.y + v3*b.z) * b.w.
function interpolate3(v1: Vec3, v2: Vec3, v3: Vec3, b: Vec4): Vec3 {
  return scale3(add(add(add(ZERO, scale3(v1, b.x)), scale3(v2, b.y)), scale3(v3, b.z)), b.w)
}

function interpolate4(v1: Vec4, v2: Vec4, v3: Vec4, b: Vec4): Vec4 {
  return scale4(add4(add4(add4(vec4(0, 0, 0, 0), scale4(v1, b.x)), scale4(v2, b.y)), scale4(v3, b.z)), b.w)
}

function interpolateVertex(v1: OutVertex, v2: OutVertex, v3: OutVertex, b: Vec4): OutVertex {
  return {
    position: interpolate3(v1.position, v2.position, v3.position, b),
    texture: interpolate3(v1.texture, v2.texture, v3.texture, b),
    output: interpolate4(v1.output, v2.output, v3.output, b),
  }
}

function barycentric(p1: Vec3, p2: Vec3, p3: Vec3, p: Vec3): Vec4 {
  const v0 = sub(p2, p1)
  const v1 = sub(p3, p1)
  const v2 = sub(p, p1)
  const d00 = dot(v0, v0)
  const d01 = dot(v0, v1)
  const d11 = dot(v1, v1)
  const d20 = dot(v2, v0)
  const d21 = dot(v2, v1)
  const d = d00 * d11 - d01 * d01
  const v = (d11 * d20 - d01 * d21) / d
  const w = (d00 * d21 - d01 * d20) / d
  const u = 1.0 - v - w
  return vec4(u, v, w, 1.0)
}

interface ClipPlane {
  p: Vec4
  n: Vec4
}

const CLIP_PLANES: ClipPlane[] = [
  { p: vec4(1, 0, 0, 1), n: vec4(-1, 0, 0, 1) },
  { p: vec4(-1, 0, 0, 1), n: vec4(1, 0, 0, 1) },
  { p: vec4(0, 1, 0, 1), n: vec4(0, -1, 0, 1) },
  { p: vec4(0, -1, 0, 1), n: vec4(0, 1, 0, 1) },
  { p: vec4(0, 0, 1, 1), n: vec4(0, 0, -1, 1) },
  { p: vec4(0, 0, -1, 1), n: vec4(0, 0, 1, 1) },
]

const pointInFront = (c: ClipPlane, v: Vec4) => dot4(sub4(v, c.p), c.n) > 0

function intersectSegment(c: ClipPlane, v0: Vec4, v1: Vec4): Vec4 {
  const u = sub4(v1, v0)
  const w = sub4(v0, c.p)
  const d = dot4(c.n, u)
  const n = -dot4(c.n, w)
  return add4(v0, scale4(u, n / d))
}

function sutherlandHodgman(points: Vec4[]): Vec4[] {
  let output = points
  for (const plane of CLIP_PLANES) {
    const input = output
    output = []
    if (input.length === 0) return []
    let s = input[input.length - 1]!
    for (const e of input) {
      if (pointInFront(plane, e)) {
        if (!pointInFront(plane, s)) output.push(intersectSegment(plane, s, e))
        output.push(e)
      } else if (pointInFront(plane, s)) {
        output.push(intersectSegment(plane, s, e))
      }
      s = e
    }
  }
  return output
}

function clipTriangle(t: OutVertex[]): OutVertex[][] {
  const [a, b, c] = t as [OutVertex, OutVertex, OutVertex]
  const p1 = xyz(a.output)
  const p2 = xyz(b.output)
  const p3 = xyz(c.output)
  const points = sutherlandHodgman([a.output, b.output, c.output])
  const out: OutVertex[][] = []
  for (let i = 2; i < points.length; i++) {
    const b1 = barycentric(p1, p2, p3, xyz(points[0]!))
    const b2 = barycentric(p1, p2, p3, xyz(points[i - 1]!))
    const b3 = barycentric(p1, p2, p3, xyz(points[i]!))
    out.push([interpolateVertex(a, b, c, b1), interpolateVertex(a, b, c, b2), interpolateVertex(a, b, c, b3)])
  }
  return out
}

// texelIndex is (y*w + x) * 4 in Go's int64 arithmetic, which wraps. A NaN
// coordinate converts to the minimum int64, and the wrapped product can
// land back on the texture (texel 0 for an even width): Go samples it then,
// so this does too. Ordinary coordinates take the plain path.
function texelIndex(x: number, y: number, w: number): number {
  if (Math.abs(x) < 2 ** 31 && Math.abs(y) < 2 ** 31) return (y * w + x) * 4
  const i = BigInt.asIntN(64, (BigInt.asIntN(64, BigInt(y) * BigInt(w)) + BigInt(x)) * 4n)
  return i < 0n || i > BigInt(Number.MAX_SAFE_INTEGER) ? -1 : Number(i)
}

// DEPTH_TIE is how much nearer, in screen depth (0 near to 1 far), a fragment
// must be to replace what is drawn: coplanar faces differ by rounding,
// around 1e-14; the closest real layers by over 1e-7.
const DEPTH_TIE = 1e-10

// ALPHA_THRESHOLD is the alpha test: fragments below half opacity
// (alpha/255 < 0.5, a byte below 128) are dropped, colour and depth both.
const ALPHA_THRESHOLD = 128

// Context is a colour and depth buffer to draw triangles into.
export class Context {
  readonly color: Uint8ClampedArray
  private readonly depth: Float64Array
  private readonly screen: Mat4

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.color = new Uint8ClampedArray(width * height * 4)
    this.depth = new Float64Array(width * height).fill(Number.MAX_VALUE)
    this.screen = screen(width, height)
  }

  image(): RgbaImage {
    const img = newImage(this.width, this.height)
    img.data.set(this.color)
    return img
  }

  // drawTriangle draws one triangle: the vertex stage (matrix), clipping,
  // then rasterization with the alpha-tested texture. Back faces are drawn
  // too: cube winding is not consistent.
  drawTriangle(t: Triangle, matrix: Mat4, tex: RgbaImage): void {
    const v: OutVertex[] = t.map((vert) => ({ position: vert.position, texture: vert.texture, output: mulPositionW(matrix, vert.position) }))
    // Only a triangle crossing the near or far plane is clipped. One that
    // merely runs off the image is drawn whole and rasterize keeps to the
    // image: clipping its two halves apart left a gap down a face's
    // diagonal.
    if (v.some((vert) => depthOutside(vert.output))) {
      for (const c of clipTriangle(v)) this.drawClipped(c, tex)
    } else {
      this.drawClipped(v, tex)
    }
  }

  private drawClipped(v: OutVertex[], tex: RgbaImage): void {
    let v0 = v[0]!
    const v1 = v[1]!
    let v2 = v[2]!
    let ndc0 = xyz(div4(v0.output, v0.output.w))
    const ndc1 = xyz(div4(v1.output, v1.output.w))
    let ndc2 = xyz(div4(v2.output, v2.output.w))
    const a = (ndc1.x - ndc0.x) * (ndc2.y - ndc0.y) - (ndc2.x - ndc0.x) * (ndc1.y - ndc0.y)
    if (a < 0) {
      ;[v0, v2] = [v2, v0]
      ;[ndc0, ndc2] = [ndc2, ndc0]
    }
    this.rasterize(v0, v1, v2, mulPosition(this.screen, ndc0), mulPosition(this.screen, ndc1), mulPosition(this.screen, ndc2), tex)
  }

  private rasterize(v0: OutVertex, v1: OutVertex, v2: OutVertex, s0: Vec3, s1: Vec3, s2: Vec3, tex: RgbaImage): void {
    // edge(a, b, c) = (b.x - c.x) * (a.y - c.y) - (b.y - c.y) * (a.x - c.x)
    const lo = min3(s0, min3(s1, s2))
    const hi = max3(s0, max3(s1, s2))
    let x0 = gomath.goInt(Math.floor(lo.x))
    let x1 = gomath.goInt(Math.ceil(hi.x))
    let y0 = gomath.goInt(Math.floor(lo.y))
    let y1 = gomath.goInt(Math.ceil(hi.y))

    const ra = 1.0 / ((s1.x - s2.x) * (s0.y - s2.y) - (s1.y - s2.y) * (s0.x - s2.x))
    const r0 = 1.0 / v0.output.w
    const r1 = 1.0 / v1.output.w
    const r2 = 1.0 / v2.output.w
    const t0 = v0.texture
    const t1 = v1.texture
    const t2 = v2.texture

    // Only pixels on the image: off it there is nothing to draw, and a
    // pixel's index would wrap into the next row.
    const width = this.width
    x0 = Math.max(x0, 0)
    x1 = Math.min(x1, width - 1)
    y0 = Math.max(y0, 0)
    y1 = Math.min(y1, this.height - 1)
    const depth = this.depth
    const tw = tex.width
    const th = tex.height
    const pix = tex.data
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5
      for (let x = x0; x <= x1; x++) {
        // Each pixel's edge functions are worked out afresh. fauxgl steps
        // them along the row, and the rounding that accumulates let thin,
        // edge-on triangles spill slivers past their edges.
        const px = x + 0.5
        const b0 = ((s2.x - px) * (s1.y - py) - (s2.y - py) * (s1.x - px)) * ra
        const b1 = ((s0.x - px) * (s2.y - py) - (s0.y - py) * (s2.x - px)) * ra
        const b2 = ((s1.x - px) * (s0.y - py) - (s1.y - py) * (s0.x - px)) * ra
        if (b0 < 0 || b1 < 0 || b2 < 0) continue
        const i = y * width + x
        const z = b0 * s0.z + b1 * s1.z + b2 * s2.z
        const bz = z + 0.0
        if (bz > depth[i]!) continue
        const bx = b0 * r0
        const by = b1 * r1
        const bzw = b2 * r2
        const bw = 1.0 / (bx + by + bzw)
        // interpolate3 written out: ((0 + t0*bx) + t1*by + t2*bz) * bw.
        const u = (0 + t0.x * bx + t1.x * by + t2.x * bzw) * bw
        const vv = (0 + t0.y * bx + t1.y * by + t2.y * bzw) * bw

        // fauxgl's Sample, including its v = 1 - v (the mesh pre-flips V to
        // cancel it), as the texel's bytes. For u and v already in [0, 1)
        // the floors are skipped - u - floor(u) is u there, bar -0 becoming
        // +0, the same texel. A coordinate off the texture, where Go would
        // panic, draws nothing.
        let su = u
        let sv = 1.0 - vv
        if (!(su >= 0 && su < 1)) su -= Math.floor(su)
        if (!(sv >= 0 && sv < 1)) sv -= Math.floor(sv)
        const ti = texelIndex(gomath.goInt(su * tw), gomath.goInt(sv * th), tw)
        if (ti < 0 || ti + 3 >= pix.length) continue
        const a = pix[ti + 3]!
        if (a < ALPHA_THRESHOLD) continue
        // A fragment must be nearer than what is there by more than
        // DEPTH_TIE: faces only rounding sets apart leave the pixel to the
        // one drawn first. A NaN depth fails this as in Go.
        if (bz < depth[i]! - DEPTH_TIE) {
          depth[i] = z
          this.put(x, y, pix[ti]!, pix[ti + 1]!, pix[ti + 2]!, a)
        }
      }
    }
  }

  // put writes a fragment as fauxgl does: blended over what is there when
  // it is not fully opaque, else stored, and only inside the image.
  private put(x: number, y: number, r8: number, g8: number, b8: number, a8: number): void {
    const c = this.color
    const j = (y * this.width + x) * 4
    if (a8 < 255) {
      // color.NRGBA().RGBA(): premultiplied, 16 bits a channel.
      const pre = (v: number) => Math.floor(((v | (v << 8)) * a8) / 0xff)
      const sa = a8 | (a8 << 8)
      const a = (0xffff - sa) * 0x101
      if (j < 0 || j + 3 >= c.length) return
      const blend = (d: number, s: number) => ((Math.floor((d * a) / 0xffff) + s) >> 8) & 0xff
      c[j] = blend(c[j]!, pre(r8))
      c[j + 1] = blend(c[j + 1]!, pre(g8))
      c[j + 2] = blend(c[j + 2]!, pre(b8))
      c[j + 3] = blend(c[j + 3]!, sa)
    } else if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      c[j] = r8
      c[j + 1] = g8
      c[j + 2] = b8
      c[j + 3] = a8
    }
  }
}
