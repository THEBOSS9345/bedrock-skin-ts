// Poly meshes: the free-form shape Bedrock sends for persona (character
// creator) skins instead of cubes. See docs/geometry-format.md#poly-meshes in
// bedrock-skin-go.

import type { Bone, Geometry } from './geometry'
import type { JsonValue } from './json'
import { Reader } from './jsonread'
import { mulPosition, sub, vec3, vertex, type Mat4, type Triangle, type Vertex } from './raster'

// PolyMesh is a bone's poly mesh. Positions are in model space, like a
// cube's origin.
export interface PolyMesh {
  // UVs are 0..1 across the texture, V counting up; otherwise texture
  // pixels against the entry's declared texture size.
  normalizedUVs: boolean
  positions: number[][]
  normals: number[][]
  uvs: number[][]
  // A list of polygons, each a list of [position, normal, uv] index
  // triples, or the string "tri_list" / "quad_list" for vertices taken in
  // order. polygons resolves them.
  polys?: JsonValue
}

// PolyVertex is one corner of a polygon, its indices looked up: a position
// in model space, a normal (zero when the corner names no usable one), and a
// texture coordinate - 0..1 with V counting up when the mesh's
// normalizedUVs is set, else texture pixels.
export interface PolyVertex {
  position: [number, number, number]
  normal: [number, number, number]
  uv: [number, number]
}

// boneMesh is the bone's poly mesh; undefined when it has none or it does
// not read.
export function boneMesh(b: Bone): PolyMesh | undefined {
  const v = b.polyMesh
  if (v === undefined) return undefined
  const r = new Reader()
  const m: PolyMesh = { normalizedUVs: false, positions: [], normals: [], uvs: [] }
  const rows = (v: JsonValue, cur: number[][]) => r.list(v, cur, () => [] as number[], (row, out) => r.f64s(row, out))
  r.object(v, (k, v) => {
    switch (k) {
      case 'normalized_uvs':
        m.normalizedUVs = r.bool(v, m.normalizedUVs)
        break
      case 'positions':
        m.positions = rows(v, m.positions)
        break
      case 'normals':
        m.normals = rows(v, m.normals)
        break
      case 'uvs':
        m.uvs = rows(v, m.uvs)
        break
      case 'polys':
        m.polys = v
        break
    }
  })
  return r.typeError ? undefined : m
}

// polygons resolves every polygon to its corners, "tri_list" and
// "quad_list" included. A polygon with fewer than three corners, or one
// whose position or UV index points outside the mesh's lists, is skipped -
// the renderer and the detector skip it too. Normals are not drawn, so a
// missing one leaves the corner's normal zero rather than dropping the
// polygon.
export function polygons(m: PolyMesh): PolyVertex[][] {
  const polys = m.polys
  if (polys === undefined) return []
  let idx: number[][][] = []
  // A JSON string or null reads as Go's string; null is "".
  if (typeof polys === 'string' || polys === null) {
    const per = polys === 'tri_list' ? 3 : polys === 'quad_list' ? 4 : 0
    if (per === 0) return []
    for (let i = 0; i + per <= m.positions.length; i += per) {
      const poly: number[][] = []
      for (let j = 0; j < per; j++) poly.push([i + j, i + j, i + j])
      idx.push(poly)
    }
  } else {
    const r = new Reader()
    idx = r.list(polys, idx, () => [] as number[][], (v, poly) =>
      r.list(v, poly, () => [] as number[], (c, out) => r.f64s(c, out)),
    )
    if (r.typeError) return []
  }

  const out: PolyVertex[][] = []
  for (const poly of idx) {
    if (poly.length < 3) continue
    const verts: PolyVertex[] = []
    for (const c of poly) {
      const p = index(c, 0, m.positions, 3)
      const t = index(c, 2, m.uvs, 2)
      if (!p || !t) break
      const n = index(c, 1, m.normals, 3)
      verts.push({ position: [p[0]!, p[1]!, p[2]!], normal: n ? [n[0]!, n[1]!, n[2]!] : [0, 0, 0], uv: [t[0]!, t[1]!] })
    }
    if (verts.length === poly.length) out.push(verts)
  }
  return out
}

// index is corner[slot] looked up in list, wanting at least n components.
function index(corner: number[], slot: number, list: number[][], n: number): number[] | undefined {
  const f = corner[slot]
  if (f === undefined || f < 0 || f >= list.length || f !== Math.trunc(f)) return undefined
  const v = list[f]!
  return v.length >= n ? v : undefined
}

// drawsSomething reports whether a bone renders any pixels.
export const drawsSomething = (b: Bone): boolean => {
  if (b.cubes.length > 0) return true
  const m = boneMesh(b)
  return m !== undefined && polygons(m).length > 0
}

// hasMesh reports whether any bone draws something: a cube or a poly mesh.
export const hasMesh = (g: Geometry): boolean => g.bones.some(drawsSomething)

// addPolyMesh appends a poly mesh's polygons, fanned into triangles, placed
// as a cube is placed: through the bone's world transform from its pivot,
// then X mirrored. The UVs ride on the vertices, so the mirror needs no U
// flip.
export function addPolyMesh(triangles: Triangle[], m: PolyMesh, b: Bone, world: Mat4, texW: number, texH: number): void {
  const pivot = vec3(b.pivot[0] ?? 0, b.pivot[1] ?? 0, b.pivot[2] ?? 0)
  for (const poly of polygons(m)) {
    const verts: Vertex[] = poly.map((c) => {
      const p = mulPosition(world, sub(vec3(c.position[0], c.position[1], c.position[2]), pivot))
      // Normalized UVs count V up, as the sampler does; pixel UVs count down
      // from the top, as a cube's do.
      let [u, v] = c.uv
      if (!m.normalizedUVs) {
        u = u / texW
        v = 1.0 - v / texH
      }
      return vertex(vec3(-p.x, p.y, p.z), u, v)
    })
    for (let i = 1; i < verts.length - 1; i++) triangles.push([verts[0]!, verts[i]!, verts[i + 1]!])
  }
}
