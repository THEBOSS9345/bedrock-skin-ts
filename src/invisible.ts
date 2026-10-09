// Detecting invisible and partly invisible skins: whether each body part has
// enough opaque texture where its cubes are mapped. See
// docs/api-reference.md#invisibility-detection in bedrock-skin-go.

import { SkinError } from './errors'
import { parseGeometry, totalCubes, type Bone, type Geometry } from './geometry'
import * as gomath from './gomath'
import type { RgbaImage } from './image'
import { boxUVRects, cubeDims, cubeUVRects } from './mesh'
import { boneMesh, drawsSomething, hasMesh, polygons, type PolyMesh } from './polymesh'
import { ANIMATED_BODY_128, ANIMATED_BODY_32, ANIMATED_FACE, animatedEntry } from './render'
import { compareBytes, sameBone } from './strings'

// The minimum alpha (0..1) for a pixel to count as visible: anything but
// fully transparent.
export const DEFAULT_MIN_VISIBLE_ALPHA = 0.5 / 255.0

// The share of a part's sampled pixels that must be opaque for it to count
// as visible: a part more than half transparent is effectively invisible.
export const DEFAULT_MIN_VISIBLE_FRACTION = 0.5

// The size a bone must reach on its largest axis not to be judged too small
// to see. A flat plane is visible; a bone small on every axis is not.
export const DEFAULT_MIN_GEOMETRY_SIZE = 0.5

// How many of the six standard body parts must be visible for a skin not to
// be suspicious.
export const DEFAULT_MIN_VISIBLE_PARTS = 4

// Thresholds are the tunable part of one detection run. A zero field takes
// its default.
export interface Thresholds {
  minVisibleFraction: number
  minGeometrySize: number
  minVisibleParts: number
}

export const resolved = (th: Partial<Thresholds>): Thresholds => ({
  minVisibleFraction: !th.minVisibleFraction || th.minVisibleFraction <= 0 ? DEFAULT_MIN_VISIBLE_FRACTION : th.minVisibleFraction,
  minGeometrySize: !th.minGeometrySize || th.minGeometrySize <= 0 ? DEFAULT_MIN_GEOMETRY_SIZE : th.minGeometrySize,
  minVisibleParts: !th.minVisibleParts ? DEFAULT_MIN_VISIBLE_PARTS : th.minVisibleParts,
})

// SkinPartResult is the visibility of one body part. With geometry, it
// reflects the part's real cube UV regions; without, the standard vanilla
// layout.
export interface SkinPartResult {
  name: string
  visible: boolean
  fraction: number
  pixels: number
  transparent: number
  // The part came from geometry, not the fallback layout.
  fromGeo: boolean
  // The geometry defines the part below the minimum size.
  tiny: boolean
}

// SkinVisibilityResult is the result of validateSkinVisibility and
// validateSkinInvisibility. suspicious flags a half-invisible skin: some
// parts visible, but fewer of the standard six than the minimum.
export interface SkinVisibilityResult {
  isInvisible: boolean
  pass: boolean
  suspicious: boolean
  parts: SkinPartResult[]
  visibleParts: number
  invisibleParts: number
}

// GeometryViolation is a bone smaller than the minimum.
export interface GeometryViolation {
  bone: string
  size: number
  minimum: number
}

// GeometrySizeResult is the result of validateGeometrySize.
export interface GeometrySizeResult {
  pass: boolean
  violations: GeometryViolation[]
}

type Layout = readonly (readonly [string, readonly [number, number, number, number, number]])[]

// The six visible body parts of a standard humanoid skin, against a
// 64-wide texture: (u, v, width, height, depth).
const STANDARD_BODY_PARTS: Layout = [
  ['head', [8, 8, 8, 8, 8]],
  ['body', [20, 20, 8, 12, 4]],
  ['rightArm', [44, 20, 4, 12, 4]],
  ['leftArm', [36, 52, 4, 12, 4]],
  ['rightLeg', [4, 20, 4, 12, 4]],
  ['leftLeg', [20, 52, 4, 12, 4]],
]

// The pre-1.8 64x32 layout. Its left arm and leg point off the texture, so
// they count as invisible.
const LEGACY32_BODY_PARTS: Layout = [
  ['head', [0, 0, 8, 8, 8]],
  ['body', [16, 16, 8, 12, 4]],
  ['rightArm', [40, 16, 4, 12, 4]],
  ['rightLeg', [0, 16, 4, 12, 4]],
]

export const STANDARD_PART_NAMES: readonly string[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']

// Clothing overlay bones and the standard part each covers.
const OVERLAYS: readonly (readonly [string, string])[] = [
  ['hat', 'head'],
  ['jacket', 'body'],
  ['leftSleeve', 'leftArm'],
  ['rightSleeve', 'rightArm'],
  ['leftPants', 'leftLeg'],
  ['rightPants', 'rightLeg'],
]

// standardName is the standard part a bone name spells, ignoring case as
// Bedrock does (persona models say "leftarm").
const standardName = (name: string): string | undefined => STANDARD_PART_NAMES.find((std) => sameBone(name, std))

// partOf is the standard part a bone's visibility counts toward: the part
// itself, or the part an overlay covers. Any other bone counts for itself.
function partOf(name: string): string {
  const std = standardName(name)
  if (std !== undefined) return std
  return OVERLAYS.find(([overlay]) => sameBone(name, overlay))?.[1] ?? name
}

// Accessories are reported but never count: an opaque cape must not make an
// invisible body pass.
const isAccessory = (name: string) => sameBone(name, 'cape')

// geometryInput is the raw geometry.json a detector call takes: bytes, a
// string, or nothing for a skin that sends none.
export type GeometryInput = Uint8Array | string | undefined

// validateSkinVisibility checks whether a skin has visible body parts. With
// geometry (raw geometry.json), every bone with cubes is checked against the
// texture where its UVs point, so a player cannot hide behind geometry
// mapped to transparent pixels; without, the standard layout is used.
//
// Persona geometry - bones, none with cubes - is trusted visible. Geometry
// that fails to parse is not that: it is checked like no geometry.
export function validateSkinVisibility(texture: RgbaImage, geometry: GeometryInput, minVisibleFraction: number): SkinVisibilityResult {
  const scan = scanParts(texture, getGeometry(geometry))
  if (scan === 'unusable') return unusableResult()
  if (scan === 'persona') return personaResult()
  return classify(scan.parts, resolved({ minVisibleFraction }), scan.strict)
}

// A scan is no texture to analyse at all; real bones, no cubes (trusted
// visible); or measured parts, strict when they came from box-UV geometry.
type Scan = 'unusable' | 'persona' | { parts: SkinPartResult[]; strict: boolean }

// unusableResult fails closed: a missing texture reads as invisible as well
// as failing.
const unusableResult = (): SkinVisibilityResult => ({
  isInvisible: true,
  pass: false,
  suspicious: false,
  parts: [],
  visibleParts: 0,
  invisibleParts: 0,
})

const part = (name: string, p: Partial<SkinPartResult> = {}): SkinPartResult => ({
  name,
  visible: false,
  fraction: 0,
  pixels: 0,
  transparent: 0,
  fromGeo: false,
  tiny: false,
  ...p,
})

const personaResult = (): SkinVisibilityResult => ({
  isInvisible: false,
  pass: true,
  suspicious: false,
  parts: STANDARD_PART_NAMES.map((n) => part(n, { visible: true, fraction: 1, fromGeo: true })),
  visibleParts: 0,
  invisibleParts: 0,
})

// Parsed is the entry the detector judges, its bones by name (a repeated
// name's last bone wins, as in Go's map), and the persona animated entries
// that draw alongside it.
interface Parsed {
  geo: Geometry
  bones: Map<string, Bone>
  companions: Geometry[]
}

function scanParts(texture: RgbaImage, geo: Parsed | undefined): Scan {
  const tw = texture.width
  const th = texture.height
  if (tw <= 0 || th <= 0) return 'unusable'
  if (geo && hasMesh(geo.geo)) {
    // The geometry gives authoritative regions, so the verdict can be
    // strict.
    const parts = checkFromGeometry(geo, texture, tw, th)
    parts.push(...animatedParts(parts, geo.companions))
    return { parts, strict: true }
  }
  // This tests parsed bones, not "some bytes were passed": garbage geometry
  // must not switch the detector off. See
  // docs/design-decisions.md#why-persona-detection-tests-parsed-bones.
  if (geo && geo.bones.size > 0) return 'persona'
  return { parts: checkFromStandardUV(texture, tw, th), strict: false }
}

// uvScale is the scale from a 64-wide reference layout to the texture. A
// 64x32 atlas uses its own absolute coordinates.
const uvScale = (tw: number, th: number): [number, number] => (th === 32 ? [1, 1] : [tw / 64, th / 64])

const fractionOf = (total: number, transparent: number) => (total > 0 ? (total - transparent) / total : 0)

// checkFromGeometry scales UVs from the geometry's declared texture size, as
// the renderer samples them. See
// docs/design-decisions.md#why-the-detector-scales-by-the-declared-texture-size.
function checkFromGeometry(p: Parsed, texture: RgbaImage, tw: number, th: number): SkinPartResult[] {
  const sx = tw / p.geo.textureWidth
  const sy = th / p.geo.textureHeight
  const measure = (name: string, bone: Bone): SkinPartResult => {
    let [total, transparent] = countBoneTexture(bone, texture, sx, sy)
    const m = boneMesh(bone)
    if (m) {
      const [t, tr] = countPolyTexture(m, texture, sx, sy)
      total += t
      transparent += tr
    }
    return part(name, { visible: true, pixels: total, transparent, fromGeo: true, fraction: fractionOf(total, transparent) })
  }
  const seen = new Set<string>()
  const results: SkinPartResult[] = []
  // The six standard parts first, in their fixed order; then the rest by
  // name, so a report is the same every time.
  for (const name of STANDARD_PART_NAMES) {
    const b = findBone(p, name)
    if (b && drawsSomething(b)) {
      seen.add(b.name)
      results.push(measure(name, b))
    }
  }
  const rest = [...p.bones].filter(([n, b]) => !seen.has(n) && drawsSomething(b)).sort((a, b) => compareBytes(a[0], b[0]))
  for (const [name, b] of rest) results.push(measure(name, b))
  return results
}

// findBone is a standard part's bone: the exact name if present, else the
// first bone spelling it in another case.
function findBone(p: Parsed, name: string): Bone | undefined {
  const exact = p.bones.get(name)
  if (exact) return exact
  const found = p.geo.bones.find((b) => sameBone(b.name, name))
  return found && p.bones.get(found.name)
}

// animatedParts are the standard parts a persona skin draws only from its
// animated entries (the face, animated limbs), trusted visible: their
// textures travel in the skin's animations, which the detector is not
// given. A part measured from the main texture keeps its measurement. See
// docs/design-decisions.md#why-animated-persona-parts-are-trusted.
function animatedParts(measured: SkinPartResult[], companions: Geometry[]): SkinPartResult[] {
  const have = new Set(measured.map((p) => partOf(p.name)))
  return STANDARD_PART_NAMES.filter((std) => !have.has(std))
    .filter((std) => companions.some((g) => g.bones.some((b) => partOf(b.name) === std && drawsSomething(b))))
    .map((std) => part(std, { visible: true, fraction: 1, fromGeo: true }))
}

// isTransparent is the alpha test, on the 16-bit alpha Go's image reads.
const isTransparent = (img: RgbaImage, x: number, y: number) => {
  const a = img.data[(y * img.width + x) * 4 + 3]!
  return (a | (a << 8)) / 65535.0 <= DEFAULT_MIN_VISIBLE_ALPHA
}

// countPolyTexture is the texture pixels a poly mesh's polygons cover -
// those whose centre falls inside one - and how many are transparent.
// Normalized UVs span the whole texture, V counting up; pixel UVs scale like
// a cube's.
function countPolyTexture(m: PolyMesh, texture: RgbaImage, sx: number, sy: number): [number, number] {
  const w = texture.width
  const h = texture.height
  let total = 0
  let transparent = 0
  for (const poly of polygons(m)) {
    const pts = poly.map((c): [number, number] => (m.normalizedUVs ? [c.uv[0] * w, (1.0 - c.uv[1]) * h] : [c.uv[0] * sx, c.uv[1] * sy]))
    let [x0, y0] = pts[0]!
    let [x1, y1] = pts[0]!
    for (const p of pts.slice(1)) {
      x0 = gomath.min(x0, p[0])
      x1 = gomath.max(x1, p[0])
      y0 = gomath.min(y0, p[1])
      y1 = gomath.max(y1, p[1])
    }
    // image.Rect puts the corners in order, then clampedBounds clips.
    const [ax0, ax1] = clip(gomath.goInt(Math.floor(x0)), gomath.goInt(Math.ceil(x1)), texture.width)
    const [ay0, ay1] = clip(gomath.goInt(Math.floor(y0)), gomath.goInt(Math.ceil(y1)), texture.height)
    if (ax0 >= ax1 || ay0 >= ay1) continue
    for (let y = ay0; y < ay1; y++) {
      for (let x = ax0; x < ax1; x++) {
        if (!inPolygon(pts, x + 0.5, y + 0.5)) continue
        total++
        if (isTransparent(texture, x, y)) transparent++
      }
    }
  }
  return [total, transparent]
}

// clip orders a span's ends, as Go's image.Rect does, and clips it to
// 0..limit.
const clip = (a: number, b: number, limit: number): [number, number] => [Math.max(Math.min(a, b), 0), Math.min(Math.max(a, b), limit)]

// inPolygon reports whether (px, py) is inside the polygon fanned from its
// first corner, edges included.
function inPolygon(pts: [number, number][], px: number, py: number): boolean {
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[0]!
    const b = pts[i]!
    const c = pts[i + 1]!
    const d = [edge(a, b, px, py), edge(b, c, px, py), edge(c, a, px, py)]
    if (!(d.some((v) => v < 0) && d.some((v) => v > 0))) return true
  }
  return false
}

// edge is the 2D cross product (b - a) x (p - a).
const edge = (a: [number, number], b: [number, number], px: number, py: number) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])

function countBoneTexture(bone: Bone, texture: RgbaImage, sx: number, sy: number): [number, number] {
  let total = 0
  let transparent = 0
  for (const cube of bone.cubes) {
    // Go keeps the faces in a map, so a repeated face counts once.
    const rects = cubeUVRects(cube)
    if (!rects) continue
    for (const r of rects.values()) {
      const [t, tr] = regionVisibility(
        texture,
        gomath.goInt(r.x * sx),
        gomath.goInt(r.y * sy),
        gomath.goInt((r.x + r.w) * sx),
        gomath.goInt((r.y + r.h) * sy),
      )
      total += t
      transparent += tr
    }
  }
  return [total, transparent]
}

function checkFromStandardUV(texture: RgbaImage, tw: number, th: number): SkinPartResult[] {
  const [sx, sy] = uvScale(tw, th)
  const layout = th === 32 ? LEGACY32_BODY_PARTS : STANDARD_BODY_PARTS
  return STANDARD_PART_NAMES.map((name) => {
    const entry = layout.find(([n]) => n === name)
    if (!entry) return part(name)
    const [u, v, w, h, d] = entry[1]
    const r = boxUVRects(u * sx, v * sy, w * sx, h * sy, d * sy)[2]![1] // north
    const [px, tr] = regionVisibility(texture, gomath.goInt(r.x), gomath.goInt(r.y), gomath.goInt(r.x + r.w), gomath.goInt(r.y + r.h))
    return part(name, { visible: true, pixels: px, transparent: tr, fraction: fractionOf(px, tr) })
  })
}

// classify settles each part's visibility from its fraction and whether the
// skin as a whole is invisible, counting the six standard parts only:
// overlays fold into the part they cover and accessories are ignored.
//
// Strict (box-UV geometry): 0-1 parts visible is invisible, 2-3 suspicious.
// Lenient (layout inferred): only 0 is invisible.
export function classify(results: SkinPartResult[], th: Thresholds, strict: boolean): SkinVisibilityResult {
  const visibleParent = new Set<string>()
  for (const r of results) {
    r.visible = r.fraction >= th.minVisibleFraction
    if (isAccessory(r.name)) continue
    if (r.visible) visibleParent.add(partOf(r.name))
  }
  const visible = STANDARD_PART_NAMES.filter((n) => visibleParent.has(n)).length
  const isInvisible = strict ? visible <= 1 : visible === 0
  return {
    suspicious: visible >= 1 && visible < th.minVisibleParts && !isInvisible,
    pass: !isInvisible,
    isInvisible,
    parts: results,
    visibleParts: visible,
    invisibleParts: STANDARD_PART_NAMES.length - visible,
  }
}

// validateGeometrySize checks that the geometry's bones are big enough to
// see: the largest axis of the box around each bone's cubes, inflate
// included, must reach minSize (0 for the default). Violations are ordered
// by bone name.
export function validateGeometrySize(geometry: GeometryInput, minSize: number): GeometrySizeResult {
  return geometrySizeOf(getGeometry(geometry)?.bones, minSize)
}

function geometrySizeOf(bones: Map<string, Bone> | undefined, minSize: number): GeometrySizeResult {
  if (minSize <= 0) minSize = DEFAULT_MIN_GEOMETRY_SIZE
  bones ??= new Map()
  if (![...bones.keys()].some((n) => sameBone(n, 'head'))) {
    return { pass: false, violations: [{ bone: 'head', size: 0, minimum: minSize }] }
  }
  const violations: GeometryViolation[] = []
  for (const n of [...bones.keys()].sort(compareBytes)) {
    const b = bones.get(n)!
    if (b.cubes.length === 0) continue
    const size = boneWorldSize(b)
    if (size < minSize) violations.push({ bone: n, size, minimum: minSize })
  }
  return { pass: violations.length === 0, violations }
}

// validateSkinInvisibility is the main check: every bone the geometry
// defines is checked where its UVs point, and a bone too small to see counts
// as invisible however opaque it is. Pass no geometry for standard skins -
// most real skins send none.
export function validateSkinInvisibility(texture: RgbaImage, geometry?: GeometryInput): SkinVisibilityResult {
  return validateWith(texture, geometry, {})
}

export function validateWith(texture: RgbaImage, geometry: GeometryInput, thresholds: Partial<Thresholds>): SkinVisibilityResult {
  const th = resolved(thresholds)
  const geo = getGeometry(geometry)
  const scan = scanParts(texture, geo)
  if (scan === 'unusable') return unusableResult()
  if (scan === 'persona') return personaResult()
  const { parts, strict } = scan
  // Size only means something when geometry parsed into bones; without, the
  // missing-head violation would flag an ordinary skin.
  if (geo && geo.bones.size > 0) {
    // Standard parts are reported under their standard spelling.
    const tiny = new Set(geometrySizeOf(geo.bones, th.minGeometrySize).violations.map((v) => standardName(v.bone) ?? v.bone))
    for (const p of parts) {
      if (tiny.has(p.name)) {
        p.tiny = true
        p.fraction = 0
      }
    }
  }
  return classify(parts, th, strict)
}

// isSkinInvisible reports whether the skin is invisible by the standard
// layout, with no geometry.
export const isSkinInvisible = (texture: RgbaImage): boolean =>
  validateSkinVisibility(texture, undefined, DEFAULT_MIN_VISIBLE_FRACTION).isInvisible

// isSkinTiny reports whether the geometry defines body parts too small to
// see.
export const isSkinTiny = (geometry: GeometryInput): boolean => !validateGeometrySize(geometry, DEFAULT_MIN_GEOMETRY_SIZE).pass

// regionVisibility is (pixels in the region, how many are fully
// transparent), the region clipped to the texture.
function regionVisibility(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): [number, number] {
  // As Go's image.Rect, corners given either way round: a per-face uv with a
  // negative size (a flipped face) still covers its pixels.
  ;[x0, x1] = clip(x0, x1, img.width)
  ;[y0, y1] = clip(y0, y1, img.height)
  if (x0 >= x1 || y0 >= y1) return [0, 0]
  let transparent = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (isTransparent(img, x, y)) transparent++
  }
  return [(x1 - x0) * (y1 - y0), transparent]
}

// boneWorldSize is the largest axis of the box around every cube in the
// bone, inflate included. A box rather than a sum of sizes, so a hundred
// invisible specks cannot add up to a visible bone. See
// docs/design-decisions.md#why-bone-size-is-a-bounding-box.
function boneWorldSize(b: Bone): number {
  const lo = [0, 0, 0]
  const hi = [0, 0, 0]
  let measured = false
  for (const c of b.cubes) {
    const dims = cubeDims(c)
    if (!dims) continue
    const inflate = c.inflate ?? b.inflate
    for (let i = 0; i < 3; i++) {
      const l = dims.origin[i]! - inflate
      const h = dims.origin[i]! + dims.size[i]! + inflate
      if (!measured) {
        lo[i] = l
        hi[i] = h
        continue
      }
      if (l < lo[i]!) lo[i] = l
      if (h > hi[i]!) hi[i] = h
    }
    measured = true
  }
  if (!measured) return 0
  let largest = hi[0]! - lo[0]!
  for (let i = 1; i < 3; i++) {
    const e = hi[i]! - lo[i]!
    if (e > largest) largest = e
  }
  return largest
}

// getGeometry is the entry with the most cubes, and the persona animated
// entries drawn with it; undefined for empty or unreadable input.
function getGeometry(raw: GeometryInput): Parsed | undefined {
  if (raw === undefined || raw.length === 0) return undefined
  let geos: Geometry[]
  try {
    geos = parseGeometry(raw)
  } catch (e) {
    if (e instanceof SkinError) return undefined
    throw e
  }
  let geo = geos[0]
  if (!geo) return undefined
  for (const g of geos.slice(1)) if (totalCubes(g) > totalCubes(geo)) geo = g
  const main = geo
  const companions = [ANIMATED_FACE, ANIMATED_BODY_32, ANIMATED_BODY_128]
    .map((t) => animatedEntry(geos, t))
    .filter((g): g is Geometry => g !== undefined && g.identifier !== main.identifier)
  return { geo: main, bones: new Map(main.bones.map((b) => [b.name, b])), companions }
}
