import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SkinError } from '../src/errors'
import {
  defaultGeometry,
  findCape,
  isEmpty,
  newBone,
  parseGeometry,
  parseResourcePatch,
  readBone,
  selectGeometry,
  type Bone,
} from '../src/geometry'
import { JsonObject, parseJSON, type JsonValue } from '../src/json'
import { Reader } from '../src/jsonread'

// plain turns parsed JSON and maps into plain values to compare, an object's
// repeated key keeping its last value, as Go reads one.
function plain(v: unknown): unknown {
  if (v instanceof JsonObject) {
    const o: Record<string, unknown> = {}
    for (const [k, val] of v.entries) o[k] = plain(val)
    return o
  }
  if (v instanceof Map) return plain(new JsonObject([...v.entries()] as [string, JsonValue][]))
  if (Array.isArray(v)) return v.map(plain)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) if (val !== undefined) o[k] = plain(val)
    return o
  }
  return v
}

// goBones reads the bones Go wrote back out, which use geometry.json's own
// field names.
function goBones(v: JsonValue): Bone[] {
  const r = new Reader()
  return r.list(v, [], newBone, (bv, b) => readBone(r, bv, b))
}

interface GeometryCase {
  Input: string
  Error: boolean
  Geometries: string | null
  Patch: { Default: string; Cape: string } | null
}

describe('geometry', () => {
  // testdata/parity/geometry.json holds what bedrock-skin-go parsed from each
  // input: both formats, wrong types, nulls, repeated keys in any case, and
  // input that is not geometry.
  it('parses as Go does', () => {
    const raw = readFileSync('testdata/parity/geometry.json', 'utf8')
    const cases = JSON.parse(raw) as GeometryCase[]
    // The Geometries are read again with the port's own parser, which keeps
    // their keys as Go wrote them.
    const doc = parseJSON(raw) as JsonValue[]
    expect(cases.length).toBeGreaterThan(20)
    cases.forEach((c, i) => {
      if (c.Input.startsWith('patch:')) {
        const input = c.Input.slice('patch:'.length)
        let got
        try {
          got = parseResourcePatch(input)
        } catch (e) {
          expect(c.Error, `patch ${input}: ${e}`).toBe(true)
          expect(e).toBeInstanceOf(SkinError)
          return
        }
        expect(c.Error, `patch ${input}`).toBe(false)
        expect(got, `patch ${input}`).toEqual({ default: c.Patch!.Default, cape: c.Patch!.Cape })
        return
      }
      let got
      try {
        got = parseGeometry(c.Input)
      } catch (e) {
        expect(c.Error, `${c.Input.slice(0, 80)}: ${e}`).toBe(true)
        expect(e).toBeInstanceOf(SkinError)
        return
      }
      expect(c.Error, c.Input.slice(0, 80)).toBe(false)
      const want = ((doc[i] as JsonObject).get('Geometries') ?? null) as JsonValue[] | null
      expect(got.length, `${c.Input.slice(0, 80)}: entries`).toBe(want?.length ?? 0)
      got.forEach((g, j) => {
        const w = want![j] as JsonObject
        expect(g.identifier).toBe(w.get('Identifier'))
        expect([g.textureWidth, g.textureHeight], g.identifier).toEqual([w.get('TextureWidth'), w.get('TextureHeight')])
        expect([g.visibleBoundsWidth, g.visibleBoundsHeight]).toEqual([w.get('VisibleBoundsWidth'), w.get('VisibleBoundsHeight')])
        expect(g.visibleBoundsOffset).toEqual(w.get('VisibleBoundsOffset') ?? [])
        expect(plain(g.bones), `${g.identifier}: bones`).toEqual(plain(goBones(w.get('Bones') ?? null)))
      })
    })
  })

  it('has the default bodies and cape', () => {
    const geos = defaultGeometry()
    expect(geos.map((g) => g.identifier)).toEqual(['geometry.cape', 'geometry.humanoid.custom', 'geometry.humanoid.customSlim'])
    expect(selectGeometry(geos, 'geometry.humanoid.customSlim')?.identifier).toBe('geometry.humanoid.customSlim')
    // With no identifier, the entry with the most cubes, not the first.
    expect(selectGeometry(geos, '')?.identifier).not.toBe('geometry.cape')
    expect(findCape(geos)?.identifier).toBe('geometry.cape')
    expect(selectGeometry([], 'x')).toBeUndefined()
  })

  it('tells no geometry from broken geometry', () => {
    expect(isEmpty('')).toBe(true)
    expect(isEmpty(' null\n')).toBe(true)
    expect(isEmpty(new TextEncoder().encode('\u00a0null'))).toBe(true)
    expect(isEmpty('\ufeffnull')).toBe(false)
    expect(isEmpty('{}')).toBe(false)
    expect(parseGeometry('null')).toEqual([])
    expect(() => parseGeometry('{')).toThrow(SkinError)
  })
})

describe('json', () => {
  it('keeps keys in file order, repeats included', () => {
    const v = parseJSON('{"1": "a", "0.5": "b", "0": "c", "0.5": "d"}') as JsonObject
    expect(v.entries.map((e) => e[0])).toEqual(['1', '0.5', '0', '0.5'])
    expect(v.get('0.5')).toBe('d')
  })

  it('has Go grammar', () => {
    for (const bad of ['{"a":1,}', '[1,]', '01', '.5', '+1', '1.', '// x\n1', '\ufeff1', 'nul', '"\u0001"', '{"a" 1}']) {
      expect(() => parseJSON(bad), bad).toThrow()
    }
    expect(parseJSON(' [1e2, -0.5, "\\u00e9\\ud83d\\ude00", "\\ud800x"] ')).toEqual([100, -0.5, 'é😀', '�x'])
    expect(parseJSON('1e400')).toBe(Infinity)
  })
})
