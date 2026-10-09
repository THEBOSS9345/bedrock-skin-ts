// Bedrock's geometry.json: parsing both of its formats into one model. See
// docs/geometry-format.md in bedrock-skin-go.

import { SkinError } from './errors'
import defaultGeometryJSON from './generated/default_geometry'
import { isObject, JsonObject, JsonSyntaxError, parseJSON, text, type JsonValue } from './json'
import { Reader, readF64s } from './jsonread'
import { compareBytes, trimSpace } from './strings'

// Bone is one bone of a model: a named node in the tree, holding cubes. The
// fields mirror geometry.json.
export interface Bone {
  name: string
  parent: string
  pivot: number[]
  rotation: number[]
  inflate: number
  mirror: boolean
  cubes: Cube[]
  // The rest of the schema, kept so a whole file can be read. The poly mesh
  // is drawn; texture meshes are parsed but not drawn.
  bindPoseRotation: number[]
  locators: Map<string, Locator>
  polyMesh?: JsonValue
  textureMeshes?: JsonValue
}

// Locator is a named point on a bone: where an item is held, a lead ties,
// particles start. A file writes one as just an offset, [x, y, z], or as an
// object with an offset and a rotation; both read into this.
export interface Locator {
  offset: number[]
  rotation: number[]
  ignoreInheritedScale: boolean
}

// Cube is one box of a bone.
export interface Cube {
  origin: number[]
  size: number[]
  // The texture mapping as written: [u, v] (box UV) or an object of faces
  // (per-face UV). See boxUV and faceUVs.
  uv?: JsonValue
  // Overrides the bone's inflate when set.
  inflate?: number
  mirror: boolean
  // Turns the cube about pivot, in degrees; pivot is in model space and
  // defaults to the cube's centre.
  rotation: number[]
  pivot: number[]
}

// FaceUV is one face's texture area in a cube's per-face uv form.
export interface FaceUV {
  uv: number[]
  uvSize: number[]
  uvRotation: number
  materialInstance: string
}

// Geometry is one normalized model - a body, a cape - whichever of Bedrock's
// two formats it came from. See parseGeometry.
export interface Geometry {
  identifier: string
  textureWidth: number
  textureHeight: number
  bones: Bone[]
  // The visible bounds: the box, in blocks, the game uses to decide the
  // model is on screen. Zero when the file leaves them out.
  visibleBoundsWidth: number
  visibleBoundsHeight: number
  visibleBoundsOffset: number[]
}

export const newBone = (): Bone => ({
  name: '',
  parent: '',
  pivot: [],
  rotation: [],
  inflate: 0,
  mirror: false,
  cubes: [],
  bindPoseRotation: [],
  locators: new Map(),
})

export const newCube = (): Cube => ({ origin: [], size: [], mirror: false, rotation: [], pivot: [] })

const newLocator = (): Locator => ({ offset: [], rotation: [], ignoreInheritedScale: false })

const newFaceUV = (): FaceUV => ({ uv: [], uvSize: [], uvRotation: 0, materialInstance: '' })

// boxUV is the cube's texture origin when its uv is the box form, [u, v],
// which lays all six faces out from that corner.
export function boxUV(c: Cube): [number, number] | undefined {
  if (c.uv === undefined) return undefined
  const arr = readF64s(c.uv)
  if (!arr || arr.length < 2) return undefined
  return [arr[0]!, arr[1]!]
}

// faceUVs is each face's texture area, by face name (north, east, south,
// west, up, down), when the cube's uv is the per-face form; undefined for
// the box form. A face it leaves out is not drawn.
export function faceUVs(c: Cube): Map<string, FaceUV> | undefined {
  const v = c.uv
  if (v === undefined || !isObject(v)) return undefined
  const r = new Reader()
  const faces = r.map(v, new Map(), newFaceUV, (fv, f) => readFaceUV(r, fv, f))
  return r.typeError ? undefined : faces
}

function readFaceUV(r: Reader, v: JsonValue, f: FaceUV): FaceUV {
  r.object(v, (k, v) => {
    switch (k) {
      case 'uv':
        f.uv = r.f64s(v, f.uv)
        break
      case 'uv_size':
        f.uvSize = r.f64s(v, f.uvSize)
        break
      case 'uv_rotation':
        f.uvRotation = r.f64(v, f.uvRotation)
        break
      case 'material_instance':
        f.materialInstance = r.string(v, f.materialInstance)
        break
    }
  })
  return f
}

export function readBone(r: Reader, v: JsonValue, b: Bone): Bone {
  r.object(v, (k, v) => {
    switch (k) {
      case 'name':
        b.name = r.string(v, b.name)
        break
      case 'parent':
        b.parent = r.string(v, b.parent)
        break
      case 'pivot':
        b.pivot = r.f64s(v, b.pivot)
        break
      case 'rotation':
        b.rotation = r.f64s(v, b.rotation)
        break
      case 'inflate':
        b.inflate = r.f64(v, b.inflate)
        break
      case 'mirror':
        b.mirror = r.bool(v, b.mirror)
        break
      case 'cubes':
        b.cubes = r.list(v, b.cubes, newCube, (cv, c) => readCube(r, cv, c))
        break
      case 'bind_pose_rotation':
        b.bindPoseRotation = r.f64s(v, b.bindPoseRotation)
        break
      case 'locators':
        b.locators = r.map(v, b.locators, newLocator, (lv) => readLocator(lv))
        break
      case 'poly_mesh':
        b.polyMesh = v
        break
      case 'texture_meshes':
        b.textureMeshes = v
        break
    }
  })
  return b
}

export function readCube(r: Reader, v: JsonValue, c: Cube): Cube {
  r.object(v, (k, v) => {
    switch (k) {
      case 'origin':
        c.origin = r.f64s(v, c.origin)
        break
      case 'size':
        c.size = r.f64s(v, c.size)
        break
      case 'uv':
        c.uv = v
        break
      case 'inflate':
        c.inflate = r.optF64(v, c.inflate)
        break
      case 'mirror':
        c.mirror = r.bool(v, c.mirror)
        break
      case 'rotation':
        c.rotation = r.f64s(v, c.rotation)
        break
      case 'pivot':
        c.pivot = r.f64s(v, c.pivot)
        break
    }
  })
  return c
}

// readLocator never fails a model: the array form, else whatever of the
// object form reads, else nothing.
export function readLocator(v: JsonValue): Locator {
  const offset = readF64s(v)
  if (offset) return { ...newLocator(), offset }
  const l = newLocator()
  if (isObject(v)) {
    const r = new Reader()
    r.object(v, (k, v) => {
      switch (k) {
        case 'offset':
          l.offset = r.f64s(v, l.offset)
          break
        case 'rotation':
          l.rotation = r.f64s(v, l.rotation)
          break
        case 'ignore_inherited_scale':
          l.ignoreInheritedScale = r.bool(v, l.ignoreInheritedScale)
          break
      }
    })
  }
  return l
}

// boneByName is the bone with the given name.
export const boneByName = (g: Geometry, name: string): Bone | undefined => g.bones.find((b) => b.name === name)

// children are the bones whose parent is the named bone, in file order.
export const children = (g: Geometry, name: string): Bone[] => g.bones.filter((b) => b.parent === name)

// totalCubes counts the cubes across every bone. A persona skin has none:
// its mesh is poly meshes.
export const totalCubes = (g: Geometry): number => g.bones.reduce((n, b) => n + b.cubes.length, 0)

// findLocator finds a locator by name on any bone, with the bone it is on.
export function findLocator(g: Geometry, name: string): [Locator, Bone] | undefined {
  for (const b of g.bones) {
    const l = b.locators.get(name)
    if (l) return [l, b]
  }
  return undefined
}

// isEmpty reports whether raw carries no geometry at all: nothing, or the
// literal JSON null a Bedrock client sends for a skin whose model is built
// into the client. Both mean "no mesh supplied", not "broken upload": use it
// to tell those apart before calling parseGeometry.
export function isEmpty(raw: Uint8Array | string): boolean {
  const t = trimSpace(text(raw))
  return t === '' || t === 'null'
}

// complexity is the total bones and cubes across every entry, roughly what
// mesh-building costs. The library enforces no limit itself: what counts as
// too large is policy.
export function complexity(geos: Geometry[]): { bones: number; cubes: number } {
  return geos.reduce((acc, g) => ({ bones: acc.bones + g.bones.length, cubes: acc.cubes + totalCubes(g) }), { bones: 0, cubes: 0 })
}

interface Description {
  identifier: string
  textureWidth: number
  textureHeight: number
  visibleBoundsWidth: number
  visibleBoundsHeight: number
  visibleBoundsOffset: number[]
}

const newDescription = (): Description => ({
  identifier: '',
  textureWidth: 0,
  textureHeight: 0,
  visibleBoundsWidth: 0,
  visibleBoundsHeight: 0,
  visibleBoundsOffset: [],
})

function readDescription(r: Reader, v: JsonValue, d: Description, legacy: boolean): void {
  r.object(v, (k, v) => {
    switch (true) {
      case k === 'identifier' && !legacy:
        d.identifier = r.string(v, d.identifier)
        break
      case k === 'texture_width' && !legacy:
      case k === 'texturewidth' && legacy:
        d.textureWidth = r.f64(v, d.textureWidth)
        break
      case k === 'texture_height' && !legacy:
      case k === 'textureheight' && legacy:
        d.textureHeight = r.f64(v, d.textureHeight)
        break
      case k === 'visible_bounds_width':
        d.visibleBoundsWidth = r.f64(v, d.visibleBoundsWidth)
        break
      case k === 'visible_bounds_height':
        d.visibleBoundsHeight = r.f64(v, d.visibleBoundsHeight)
        break
      case k === 'visible_bounds_offset':
        d.visibleBoundsOffset = r.f64s(v, d.visibleBoundsOffset)
        break
    }
  })
}

// textureSize is a declared texture dimension, or Minecraft's default of 64
// when the geometry leaves it out - real captures do. Left at zero, every UV
// divides by zero and the model renders blank.
const textureSize = (v: number) => (v > 0 ? v : 64)

const geometryOf = (d: Description, identifier: string, bones: Bone[]): Geometry => ({
  identifier,
  textureWidth: textureSize(d.textureWidth),
  textureHeight: textureSize(d.textureHeight),
  bones,
  visibleBoundsWidth: d.visibleBoundsWidth,
  visibleBoundsHeight: d.visibleBoundsHeight,
  visibleBoundsOffset: d.visibleBoundsOffset,
})

function parseDocument(raw: Uint8Array | string): JsonValue {
  try {
    return parseJSON(raw)
  } catch (e) {
    if (e instanceof JsonSyntaxError) throw new SkinError('JSON', `geometry: ${e.message}`, { cause: e })
    throw e
  }
}

// parseGeometry parses raw into normalized entries, detecting whichever of
// Bedrock's two formats it is - bone and cube fields are identical between
// them, only the wrapper differs.
//
// Valid JSON carrying no geometry, including the literal null a client sends
// for a built-in model, returns no entries and no error. An error means
// malformed input.
//
// Entry order is stable for the same input: modern keeps document order,
// legacy sorts by identifier.
export function parseGeometry(raw: Uint8Array | string): Geometry[] {
  const doc = parseDocument(raw)
  const modern = parseModern(doc)
  if (modern) return modern
  if (doc === null) return []
  if (!(doc instanceof JsonObject)) throw new SkinError('GEOMETRY', 'geometry: the top level is not an object')

  // The legacy format is a map of identifier to model: a repeated key keeps
  // its last value, as in a Go map.
  const top = new Map<string, JsonValue>()
  for (const [key, val] of doc.entries) if (key !== 'format_version') top.set(key, val)
  const out: Geometry[] = []
  for (const [key, val] of top) {
    const r = new Reader()
    const desc = newDescription()
    let bones: Bone[] = []
    readDescription(r, val, desc, true)
    r.object(val, (k, v) => {
      if (k === 'bones') bones = r.list(v, bones, newBone, (bv, b) => readBone(r, bv, b))
    })
    if (r.typeError || bones.length === 0) continue
    out.push(geometryOf(desc, key, bones))
  }
  // See docs/design-decisions.md#why-legacy-entries-are-sorted in
  // bedrock-skin-go.
  out.sort((a, b) => compareBytes(a.identifier, b.identifier))
  return out
}

// parseModern reads the modern format, minecraft:geometry, or gives
// undefined when the document is not that, or Go's decoder would have
// reported a type error reading it.
function parseModern(doc: JsonValue): Geometry[] | undefined {
  const r = new Reader()
  let models: { desc: Description; bones: Bone[] }[] = []
  r.object(doc, (k, v) => {
    if (k !== 'minecraft:geometry') return
    models = r.list(
      v,
      models,
      () => ({ desc: newDescription(), bones: [] as Bone[] }),
      (m, model) => {
        r.object(m, (k, v) => {
          if (k === 'description') readDescription(r, v, model.desc, false)
          else if (k === 'bones') model.bones = r.list(v, model.bones, newBone, (bv, b) => readBone(r, bv, b))
        })
        return model
      },
    )
  })
  if (r.typeError || models.length === 0) return undefined
  return models.map((m) => geometryOf(m.desc, m.desc.identifier, m.bones))
}

// selectGeometry is the entry matching identifier, falling back to the one
// with the most cubes when identifier is empty or matches nothing; undefined
// only for an empty list. The fallback is deliberately not the first:
// bundles commonly list the sparse cape entry first.
export function selectGeometry(geos: Geometry[], identifier: string): Geometry | undefined {
  if (identifier !== '') {
    const g = geos.find((g) => g.identifier === identifier)
    if (g) return g
  }
  let best = geos[0]
  if (!best) return undefined
  for (const g of geos.slice(1)) if (totalCubes(g) > totalCubes(best)) best = g
  return best
}

// findCape is the entry holding a bone named cape that has a cube. Capes
// live in their own entry, never merged into the body.
export const findCape = (geos: Geometry[]): Geometry | undefined =>
  geos.find((g) => (boneByName(g, 'cape')?.cubes.length ?? 0) > 0)

// ResourcePatch is a skin's decoded SkinResourcePatch: which geometry
// identifier each render slot uses.
export interface ResourcePatch {
  // The body geometry, e.g. geometry.humanoid.customSlim. Pass it as the
  // render's identifier.
  default: string
  // The cape geometry when the patch names one; most do not.
  cape: string
}

// parseResourcePatch decodes a skin's resource patch. The patch is the
// authoritative wide-vs-slim selector: the login packet's ArmSize field
// disagrees with it on real captures. Empty input, or the literal null,
// gives an empty patch and no error.
export function parseResourcePatch(raw: Uint8Array | string): ResourcePatch {
  const patch: ResourcePatch = { default: '', cape: '' }
  if (isEmpty(raw)) return patch
  let doc: JsonValue
  try {
    doc = parseJSON(raw)
  } catch (e) {
    throw new SkinError('RESOURCE_PATCH', `resource patch: ${e instanceof Error ? e.message : e}`, { cause: e })
  }
  const r = new Reader()
  r.object(doc, (k, v) => {
    if (k !== 'geometry') return
    r.object(v, (k, v) => {
      if (k === 'default') patch.default = r.string(v, patch.default)
      else if (k === 'cape') patch.cape = r.string(v, patch.cape)
    })
  })
  if (r.typeError) throw new SkinError('RESOURCE_PATCH', 'resource patch: a field has the wrong type')
  return patch
}

let defaults: Geometry[] | undefined

// defaultGeometry is the vanilla humanoid geometry: the wide
// (geometry.humanoid.custom) and slim (geometry.humanoid.customSlim) bodies,
// and geometry.cape. This is the right model for most real skins, not merely
// a fallback: a Bedrock client sends no mesh at all for a skin using a
// built-in model. The list is shared: do not change it.
export function defaultGeometry(): Geometry[] {
  return (defaults ??= parseGeometry(defaultGeometryJSON))
}
