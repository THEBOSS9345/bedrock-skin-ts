// Turning a bone tree into textured triangles. See
// docs/rendering-pipeline.md in bedrock-skin-go.

import { readF64s, Reader } from './jsonread'
import type { JsonValue } from './json'
import type { Bone, Cube, Geometry } from './geometry'
import { addPolyMesh, boneMesh } from './polymesh'
import type { Pose, BonePose } from './pose'
import { add, IDENTITY, mul, mulPosition, rotate, scale, sub, translate, vec3, vertex, type Mat4, type Triangle, type Vec3, type Vertex } from './raster'

// UVRect is a texture-pixel rectangle for one cube face.
export interface UVRect {
  x: number
  y: number
  w: number
  h: number
}

export type FaceName = 'up' | 'down' | 'north' | 'south' | 'east' | 'west'

export const FACES: readonly FaceName[] = ['up', 'down', 'north', 'south', 'east', 'west']

// boxUVRects are the six faces of Bedrock's "unwrapped box" layout for a
// cube of size (w, h, d) with UV origin (u, v), in FACES order.
export function boxUVRects(u: number, v: number, w: number, h: number, d: number): [FaceName, UVRect][] {
  return [
    ['up', { x: u + d, y: v, w, h: d }],
    ['down', { x: u + d + w, y: v, w, h: d }],
    ['north', { x: u + d, y: v + d, w, h }],
    ['south', { x: u + d + w + d, y: v + d, w, h }],
    ['east', { x: u + d + w, y: v + d, w: d, h }],
    ['west', { x: u, y: v + d, w: d, h }],
  ]
}

// cubeDims are a cube's size and origin, when both carry the three
// components the format requires. A relayed client upload has no such
// guarantee, and every caller skips the cube instead.
export function cubeDims(c: Cube): { size: [number, number, number]; origin: [number, number, number] } | undefined {
  if (c.size.length < 3 || c.origin.length < 3) return undefined
  return { size: [c.size[0]!, c.size[1]!, c.size[2]!], origin: [c.origin[0]!, c.origin[1]!, c.origin[2]!] }
}

// cubeUVRects are the cube's face rectangles by face name, or undefined when
// it has no usable uv. Per-face cubes list only the faces they draw.
export function cubeUVRects(c: Cube): Map<string, UVRect> | undefined {
  const uv = c.uv
  if (uv === undefined) return undefined
  const arr = readF64s(uv)
  if (arr && arr.length >= 2) {
    const dims = cubeDims(c)
    if (!dims) return undefined
    return new Map(boxUVRects(arr[0]!, arr[1]!, dims.size[0], dims.size[1], dims.size[2]))
  }
  return perFaceUVRects(uv)
}

// perFaceUVRects reads Bedrock's per-face form:
// {"north": {"uv": [u, v], "uv_size": [w, h]}}. A repeated face keeps its
// last entry, as in Go's map.
function perFaceUVRects(v: JsonValue): Map<string, UVRect> | undefined {
  const r = new Reader()
  const faces = r.map(
    v,
    new Map<string, { uv: number[]; uvSize: number[] }>(),
    () => ({ uv: [] as number[], uvSize: [] as number[] }),
    (fv, e) => {
      r.object(fv, (k, v) => {
        if (k === 'uv') e.uv = r.f64s(v, e.uv)
        else if (k === 'uv_size') e.uvSize = r.f64s(v, e.uvSize)
      })
      return e
    },
  )
  if (r.typeError) return undefined
  const out = new Map<string, UVRect>()
  for (const [name, e] of faces) {
    if (e.uv.length < 2) continue
    const [w, h] = e.uvSize.length >= 2 ? [e.uvSize[0]!, e.uvSize[1]!] : [0, 0]
    out.set(name, { x: e.uv[0]!, y: e.uv[1]!, w, h })
  }
  return out
}

// faceCorner maps the corner loop [-1,-1] -> [1,-1] -> [1,1] -> [-1,1] to an
// offset from the cube's centre for each face, given half-extents. The
// bottom of a face pairs with the texture's bottom row.
function faceCorner(face: FaceName, u: number, v: number, hx: number, hy: number, hz: number): Vec3 {
  switch (face) {
    case 'up':
      return vec3(u * hx, hy, v * hz)
    // "up" mirrored left to right, as Bedrock lays the bottom face out.
    case 'down':
      return vec3(-u * hx, -hy, v * hz)
    case 'north':
      return vec3(-u * hx, v * hy, -hz)
    case 'south':
      return vec3(u * hx, v * hy, hz)
    case 'east':
      return vec3(hx, v * hy, -u * hz)
    case 'west':
      return vec3(-hx, v * hy, u * hz)
  }
}

// at is v[i], or 0 past its end.
export const at = (v: readonly number[], i: number): number => v[i] ?? 0

const DEG_TO_RAD = Math.PI / 180.0

// rotationMatrix is a bone's or cube's rotation in model space: X, then Y,
// then Z, which in standard right-handed terms is Rz(-z)·Ry(y)·Rx(-x).
// fauxgl's rotation turns the opposite way to the standard one, so the signs
// here are +x, -y, +z.
export function rotationMatrix(r: readonly number[]): Mat4 {
  let m = rotate(IDENTITY, vec3(1, 0, 0), at(r, 0) * DEG_TO_RAD)
  m = rotate(m, vec3(0, 1, 0), -at(r, 1) * DEG_TO_RAD)
  return rotate(m, vec3(0, 0, 1), at(r, 2) * DEG_TO_RAD)
}

const CORNERS = [
  [-1.0, -1.0],
  [1.0, -1.0],
  [1.0, 1.0],
  [-1.0, 1.0],
] as const

// addCube appends one cube's faces (two triangles each), placed by the
// bone's world transform, with UVs in 0..1. Model space is X-mirrored
// against the world: X is negated last and each face's U flipped to match.
function addCube(triangles: Triangle[], c: Cube, b: Bone, world: Mat4, texW: number, texH: number): void {
  const dims = cubeDims(c)
  if (!dims) return
  const rects = cubeUVRects(c)
  if (!rects) return
  const { size, origin } = dims
  const inflate = c.inflate ?? b.inflate
  const sx = size[0] + 2.0 * inflate
  const sy = size[1] + 2.0 * inflate
  const sz = size[2] + 2.0 * inflate
  const hx = sx / 2.0
  const hy = sy / 2.0
  const hz = sz / 2.0

  const center = vec3(origin[0] + size[0] / 2.0, origin[1] + size[1] / 2.0, origin[2] + size[2] / 2.0)
  const pivotBone = vec3(at(b.pivot, 0), at(b.pivot, 1), at(b.pivot, 2))
  const rotated = c.rotation.length >= 3 && (c.rotation[0] !== 0 || c.rotation[1] !== 0 || c.rotation[2] !== 0)
  const cubeRot = rotated ? rotationMatrix(c.rotation) : undefined
  const cubePivot = c.pivot.length >= 3 ? vec3(c.pivot[0]!, c.pivot[1]!, c.pivot[2]!) : center
  const place = (local: Vec3): Vec3 => {
    let p = add(center, local)
    if (cubeRot) p = add(mulPosition(cubeRot, sub(p, cubePivot)), cubePivot)
    const q = mulPosition(world, sub(p, pivotBone))
    return vec3(-q.x, q.y, q.z)
  }
  const mirror = c.mirror || b.mirror

  for (const face of FACES) {
    // Mirroring flips the texture left to right: east and west trade.
    const src = mirror && face === 'east' ? 'west' : mirror && face === 'west' ? 'east' : face
    const rect = rects.get(src)
    if (!rect) continue
    let u0 = rect.x
    const v0 = rect.y
    let u1 = rect.x + rect.w
    const v1 = rect.y + rect.h
    // Negating X flips every face; flipping U puts it back. A mirrored
    // cube's own flip cancels that.
    if (!mirror) [u0, u1] = [u1, u0]
    const uv = [
      [u0, v1],
      [u1, v1],
      [u1, v0],
      [u0, v0],
    ] as const
    const verts: Vertex[] = []
    for (let i = 0; i < 4; i++) {
      const local = faceCorner(face, CORNERS[i]![0], CORNERS[i]![1], hx, hy, hz)
      // V is pre-flipped to cancel the sampler's v = 1 - v.
      verts.push(vertex(place(local), uv[i]![0] / texW, 1.0 - uv[i]![1] / texH))
    }
    triangles.push([verts[0]!, verts[1]!, verts[2]!])
    triangles.push([verts[0]!, verts[2]!, verts[3]!])
  }
}

// boneLocalMatrix is a bone's local transform: its rotation about its own
// origin, then a translation by its pivot less its parent's. A pose adds its
// rotation and position, and scales when it says to.
function boneLocalMatrix(b: Bone, parentPivot: readonly number[], p: BonePose): Mat4 {
  const own = b.pivot
  const offset = vec3(
    at(own, 0) - at(parentPivot, 0) + p.position[0],
    at(own, 1) - at(parentPivot, 1) + p.position[1],
    at(own, 2) - at(parentPivot, 2) + p.position[2],
  )
  const rot = [at(b.rotation, 0) + p.rotation[0], at(b.rotation, 1) + p.rotation[1], at(b.rotation, 2) + p.rotation[2]]
  let m = IDENTITY
  if (p.scaled) m = scale(m, vec3(p.scale[0], p.scale[1], p.scale[2]))
  if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) m = mul(rotationMatrix(rot), m)
  return translate(m, offset)
}

// boneWorldMatrices are every bone's absolute transform, composed up the
// parent chain. A parent cycle resolves to identity rather than recursing
// forever. A repeated bone name keeps its last bone, as Go's map does.
export function boneWorldMatrices(geo: Geometry, pose: Pose): Map<string, Mat4> {
  const byName = new Map<string, Bone>()
  for (const b of geo.bones) byName.set(b.name, b)
  const result = new Map<string, Mat4>()

  const resolve = (name: string, seen: string[]): Mat4 => {
    const done = result.get(name)
    if (done) return done
    const b = byName.get(name)
    if (!b) return IDENTITY
    if (seen.includes(name)) return IDENTITY
    seen.push(name)
    let parentPivot: readonly number[] = []
    let parentWorld = IDENTITY
    if (b.parent !== '') {
      const pb = byName.get(b.parent)
      if (pb) {
        parentPivot = pb.pivot
        parentWorld = resolve(b.parent, seen)
      }
    }
    const world = mul(parentWorld, boneLocalMatrix(b, parentPivot, pose.of(b.name)))
    result.set(name, world)
    return world
  }

  for (const b of geo.bones) resolve(b.name, [])
  return result
}

// buildTriangles are the triangles for every cube and poly mesh whose bone
// passes include (undefined includes everything), posed by pose.
export function buildTriangles(geo: Geometry, include: ((name: string) => boolean) | undefined, pose: Pose): Triangle[] {
  const worlds = boneWorldMatrices(geo, pose)
  const triangles: Triangle[] = []
  for (const b of geo.bones) {
    if (include && !include(b.name)) continue
    const world = worlds.get(b.name) ?? IDENTITY
    for (const c of b.cubes) addCube(triangles, c, b, world, geo.textureWidth, geo.textureHeight)
    const m = boneMesh(b)
    if (m) addPolyMesh(triangles, m, b, world, geo.textureWidth, geo.textureHeight)
  }
  return triangles
}

