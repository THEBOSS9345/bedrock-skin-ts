// Reading a whole geometry file and picking values out of it by path. See
// docs/geometry-format.md#picking-values-out-of-a-file in bedrock-skin-go.

import { SkinError } from './errors'
import { newBone, newCube, parseGeometry, readBone, readCube, readLocator, type Bone, type Cube, type Geometry, type Locator } from './geometry'
import { JsonObject, JsonSyntaxError, parseJSON, type JsonValue } from './json'
import { Reader, readF64s } from './jsonread'
import { boneMesh, type PolyMesh } from './polymesh'
import { compareBytes, toLower, trimSpace } from './strings'

// A file's values as Go's decoder reads JSON into an any: an object is a
// map, a repeated key keeping its last value, and its keys in no order.
type Tree = null | boolean | number | string | Tree[] | Map<string, Tree>

// TreeValue is a value as plain JavaScript, as JSON.parse would give it.
export type TreeValue = null | boolean | number | string | TreeValue[] | { [key: string]: TreeValue }

function toTree(v: JsonValue): Tree {
  if (v instanceof JsonObject) {
    const m = new Map<string, Tree>()
    for (const [k, val] of v.entries) m.set(k, toTree(val))
    return m
  }
  if (Array.isArray(v)) return v.map(toTree)
  // A number too big for a float64 is Go's "cannot unmarshal number".
  if (typeof v === 'number' && !Number.isFinite(v)) throw new SkinError('JSON', 'geometry: a number does not fit a float64')
  return v
}

const toJsonValue = (t: Tree): JsonValue =>
  t instanceof Map ? new JsonObject([...t].map(([k, v]) => [k, toJsonValue(v)])) : Array.isArray(t) ? t.map(toJsonValue) : t

function toPlain(t: Tree): TreeValue {
  if (t instanceof Map) {
    const out: { [key: string]: TreeValue } = {}
    for (const k of sortedKeys(t)) Object.defineProperty(out, k, { value: toPlain(t.get(k)!), enumerable: true, writable: true, configurable: true })
    return out
  }
  return Array.isArray(t) ? t.map(toPlain) : t
}

const sortedKeys = (m: Map<string, Tree>) => [...m.keys()].sort(compareBytes)

// GeometryTree is a whole geometry file, every field kept - including ones
// this library has no type for - so any value in it can be picked out by a
// path. parseGeometry gives the typed models the renderer uses; a tree is
// for reading a file:
//
//   const tree = parseGeometryTree(raw)
//   tree.get('geometry.a/bones/rightArm/pivot')?.asNumbers() // [-5, 22, 0]
//
// Both of Bedrock's formats read into the same shape, the modern one: each
// model is an object with a description (identifier, texture_width,
// texture_height, visible_bounds_*) and bones, so one path works on either.
export class GeometryTree {
  /** @internal */
  constructor(
    // The file's format_version, e.g. "1.12.0".
    readonly formatVersion: string,
    private readonly models: [string, Tree][],
    private readonly raw: Uint8Array | string,
  ) {}

  // identifiers are the models' identifiers, in the same order as
  // parseGeometry.
  identifiers(): string[] {
    return this.models.map(([id]) => id)
  }

  // select is every value the path picks out, in file order; empty when
  // nothing matches.
  //
  // A path is segments separated by /. The first picks the model by
  // identifier, the rest walk into it:
  //
  //   - an object's field by name: description, bones, locators, pivot
  //   - an array element by index, from 0 (-1 is the last), or - for a list
  //     of named things, such as bones - by its name: bones/rightArm
  //   - * for every model, field or element at that level
  //
  // Names match exactly, else case-insensitively, as the game matches bones.
  // A legacy model named geometry.a:geometry.b (one inheriting from another)
  // is also picked by geometry.a. An empty path returns every model.
  select(path: string): GeometryValue[] {
    const segs = splitPath(path)
    const out: GeometryValue[] = []
    const first = segs[0]
    const models = first === undefined || first === '*' ? this.models : this.pickModels(first)
    for (const [id, node] of models) walk(node, segs.slice(1), id, out)
    return out
  }

  // get is the first value the path picks out.
  get(path: string): GeometryValue | undefined {
    return this.select(path)[0]
  }

  // geometries are the typed models: the same as parseGeometry on the file.
  geometries(): Geometry[] {
    return parseGeometry(this.raw)
  }

  private pickModels(seg: string): [string, Tree][] {
    const matchers: ((id: string) => boolean)[] = [
      (id) => id === seg,
      (id) => eqFold(id, seg),
      (id) => {
        const colon = id.indexOf(':')
        return colon >= 0 && eqFold(id.slice(0, colon), seg)
      },
    ]
    for (const m of matchers) {
      const out = this.models.filter(([id]) => m(id))
      if (out.length > 0) return out
    }
    return []
  }
}

// parseGeometryTree reads a geometry file of either format into a tree. It
// throws a SkinError: JSON for input that is not JSON, GEOMETRY for JSON
// whose top level is not an object or whose model list holds something
// else, NO_GEOMETRY_MODELS for a file with no models.
export function parseGeometryTree(raw: Uint8Array | string): GeometryTree {
  let doc: JsonValue
  try {
    doc = parseJSON(raw)
  } catch (e) {
    if (e instanceof JsonSyntaxError) throw new SkinError('JSON', `geometry: ${e.message}`, { cause: e })
    throw e
  }
  const top = toTree(doc)
  if (top !== null && !(top instanceof Map)) throw new SkinError('GEOMETRY', 'geometry: the top level is not an object')
  const map = top ?? new Map<string, Tree>()
  const fv = map.get('format_version')
  const models: [string, Tree][] = []
  const list = map.get('minecraft:geometry')
  if (Array.isArray(list)) {
    list.forEach((m, i) => {
      if (!(m instanceof Map)) throw new SkinError('GEOMETRY', `geometry: model ${i} is not an object`)
      const desc = m.get('description')
      const id = desc instanceof Map ? desc.get('identifier') : undefined
      models.push([typeof id === 'string' ? id : '', m])
    })
  } else {
    // Legacy: each model is a top-level key. Its texture size and bounds
    // move into a description, so paths match the modern format.
    for (const [key, v] of map) {
      if (key === 'format_version' || !(v instanceof Map)) continue
      const bones = v.get('bones')
      if (!Array.isArray(bones) || bones.length === 0) continue // as parseGeometry skips it
      const desc = new Map<string, Tree>([['identifier', key]])
      // A model's own description field, if it has one, replaces this one,
      // as in the Go version.
      const out = new Map<string, Tree>([['description', desc]])
      for (const [k, val] of v) {
        switch (k) {
          case 'texturewidth':
            desc.set('texture_width', val)
            break
          case 'textureheight':
            desc.set('texture_height', val)
            break
          case 'visible_bounds_width':
          case 'visible_bounds_height':
          case 'visible_bounds_offset':
            desc.set(k, val)
            break
          default:
            out.set(k, val)
        }
      }
      models.push([key, out])
    }
    // The same order as parseGeometry.
    models.sort((a, b) => compareBytes(a[0], b[0]))
  }
  if (models.length === 0) throw new SkinError('NO_GEOMETRY_MODELS', 'no geometry models in the file')
  return new GeometryTree(typeof fv === 'string' ? fv : '', models, raw)
}

const eqFold = (a: string, b: string) => toLower(a) === toLower(b)

function splitPath(path: string): string[] {
  const p = trimSpace(path).replace(/^\/+|\/+$/g, '')
  return p === '' ? [] : p.split('/')
}

// atoi is Go's strconv.Atoi: an optionally signed decimal integer that fits
// an int64.
function atoi(s: string): number | undefined {
  if (!/^[+-]?\d+$/.test(s)) return undefined
  const n = BigInt(s)
  if (n < -(2n ** 63n) || n >= 2n ** 63n) return undefined
  return Number(n)
}

function walk(v: Tree, segs: string[], path: string, out: GeometryValue[]): void {
  const seg = segs[0]
  if (seg === undefined) {
    out.push(new GeometryValue(path, v))
    return
  }
  const rest = segs.slice(1)
  if (v instanceof Map) {
    if (seg === '*') {
      for (const k of sortedKeys(v)) walk(v.get(k)!, rest, `${path}/${k}`, out)
      return
    }
    if (v.has(seg)) {
      walk(v.get(seg)!, rest, `${path}/${seg}`, out)
      return
    }
    const k = sortedKeys(v).find((k) => eqFold(k, seg))
    if (k !== undefined) walk(v.get(k)!, rest, `${path}/${k}`, out)
    return
  }
  if (!Array.isArray(v)) return
  if (seg === '*') {
    v.forEach((child, i) => walk(child, rest, `${path}/${elementName(child, i)}`, out))
    return
  }
  let i = atoi(seg)
  if (i !== undefined) {
    if (i < 0) i += v.length
    if (i >= 0 && i < v.length) walk(v[i]!, rest, `${path}/${elementName(v[i]!, i)}`, out)
    return
  }
  for (const fold of [false, true]) {
    for (let i = 0; i < v.length; i++) {
      const name = namedElement(v[i]!)
      if (name !== '' && (name === seg || (fold && eqFold(name, seg)))) {
        walk(v[i]!, rest, `${path}/${elementName(v[i]!, i)}`, out)
        return
      }
    }
  }
}

function namedElement(v: Tree): string {
  const name = v instanceof Map ? v.get('name') : undefined
  return typeof name === 'string' ? name : ''
}

// elementName is how an array element appears in a canonical path: its name
// when it has a usable one (bones do), else its index.
function elementName(v: Tree, i: number): string {
  const name = namedElement(v)
  if (name !== '' && !name.includes('/') && atoi(name) === undefined && name !== '*') return name
  return String(i)
}

// GeometryValue is one value a path picked out: its canonical path, with
// bones and other named entries by name, and the value itself.
export class GeometryValue {
  /** @internal */
  constructor(
    readonly path: string,
    private readonly tree: Tree,
  ) {}

  // value is the value as plain JavaScript, as JSON.parse gives it.
  get value(): TreeValue {
    return toPlain(this.tree)
  }

  // asNumber is the value as a number.
  asNumber(): number | undefined {
    return typeof this.tree === 'number' ? this.tree : undefined
  }

  // asNumbers is the value as a list of numbers - a pivot, an origin, a
  // size.
  asNumbers(): number[] | undefined {
    const t = this.tree
    if (!Array.isArray(t) || !t.every((e) => typeof e === 'number')) return undefined
    return t as number[]
  }

  // asString is the value as a string - a name, a parent, an identifier.
  asString(): string | undefined {
    return typeof this.tree === 'string' ? this.tree : undefined
  }

  // bone is the value as a bone, read as parseGeometry reads one.
  bone(): Bone | undefined {
    if (!(this.tree instanceof Map)) return undefined
    const r = new Reader()
    const b = readBone(r, toJsonValue(this.tree), newBone())
    return r.typeError ? undefined : b
  }

  // cube is the value as a cube.
  cube(): Cube | undefined {
    if (!(this.tree instanceof Map)) return undefined
    const r = new Reader()
    const c = readCube(r, toJsonValue(this.tree), newCube())
    return r.typeError ? undefined : c
  }

  // polyMesh is the value as a poly mesh, read as a bone's is; e.g.
  // tree.get('*/bones/body/poly_mesh').
  polyMesh(): PolyMesh | undefined {
    if (!(this.tree instanceof Map)) return undefined
    return boneMesh({ ...newBone(), polyMesh: toJsonValue(this.tree) })
  }

  // locator is the value as a locator, in either of its forms.
  locator(): Locator | undefined {
    const v = toJsonValue(this.tree)
    return this.tree instanceof Map || readF64s(v) ? readLocator(v) : undefined
  }

  // json is the value as JSON, as Go writes it: keys sorted, and <, > and &
  // escaped.
  json(): string {
    return goJSON(this.tree)
  }
}

// goJSON writes a value as Go's json.Marshal does.
function goJSON(t: Tree): string {
  if (t === null) return 'null'
  if (typeof t === 'boolean') return String(t)
  if (typeof t === 'number') return Object.is(t, -0) ? '-0' : String(t) // JavaScript switches to exponents where Go does
  if (typeof t === 'string') return goString(t)
  if (Array.isArray(t)) return `[${t.map(goJSON).join(',')}]`
  return `{${sortedKeys(t)
    .map((k) => `${goString(k)}:${goJSON(t.get(k)!)}`)
    .join(',')}}`
}

const ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' }

function goString(s: string): string {
  // Control characters, the HTML-sensitive <, > and &, U+2028 and U+2029,
  // and lone surrogates (invalid UTF-8 in Go) are escaped.
  return `"${s.replace(/["\\\x00-\x1f<>&\u2028\u2029]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, (c) => {
    if (c in ESCAPES) return ESCAPES[c]!
    const code = c.charCodeAt(0)
    if (code >= 0xd800 && code <= 0xdfff) return '\\ufffd'
    return `\\u${code.toString(16).padStart(4, '0')}`
  })}"`
}
