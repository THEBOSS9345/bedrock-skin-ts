import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Skin, type SkinOptions } from '../src/detect'
import { SkinError } from '../src/errors'
import { parseGeometryTree } from '../src/geoquery'
import { newImage, type RgbaImage } from '../src/image'
import { isSkinInvisible, isSkinTiny, validateGeometrySize, validateSkinVisibility } from '../src/invisible'
import { JsonObject, parseJSON, type JsonValue } from '../src/json'
import { decodePNG } from '../src/png'
import { decodeWireSkin, skinOptions, wireSkinDetector } from '../src/wire'
import { customTexture, legacyTexture, read, semiTexture, testTexture } from './fixtures'

// plain is a parsed fixture as plain JavaScript, null lists as empty.
function plain(v: JsonValue | undefined): unknown {
  if (v instanceof JsonObject) return Object.fromEntries(v.entries.map(([k, val]) => [k, plain(val)]))
  if (Array.isArray(v)) return v.map(plain)
  return v
}

const nullAsEmpty = (v: unknown) => (v === null ? [] : v)

function headOnly(): RgbaImage {
  const img = testTexture()
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) if (!(x >= 8 && x < 16 && y >= 8 && y < 16)) img.data[(y * 64 + x) * 4 + 3] = 0
  }
  return img
}

describe('invisibility', () => {
  // testdata/parity/reports.json is what bedrock-skin-go reported for each
  // of these.
  it('reports every skin as Go does', () => {
    const custom = read('custom-geometry.json')
    const benchTex = decodePNG(readFileSync('testdata/bench-skin/texture.png'))
    const benchGeo = readFileSync('testdata/bench-skin/geometry.json')
    const none = new Uint8Array()
    const cases: [string, RgbaImage, Uint8Array, SkinOptions][] = [
      ['standard', testTexture(), none, {}],
      ['transparent', newImage(64, 64), none, {}],
      ['head-only', headOnly(), none, {}],
      ['legacy32', legacyTexture(), none, {}],
      ['custom', customTexture(), custom, {}],
      ['custom-128', customTexture(), read('legacy-geometry.json'), {}],
      ['persona', semiTexture(), read('persona-geometry.json'), {}],
      ['mesh', testTexture(), read('persona-mesh-geometry.json'), {}],
      ['mesh-semi', semiTexture(), read('persona-mesh-geometry.json'), {}],
      ['mesh-odd', semiTexture(), read('persona-mesh-odd.json'), {}],
      ['mesh-128', customTexture(), read('persona-mesh-geometry.json'), {}],
      ['companion', headOnly(), read('persona-companion-geometry.json'), {}],
      ['garbage-geo', testTexture(), new TextEncoder().encode('{nope'), {}],
      ['semi', semiTexture(), none, {}],
      ['strict', semiTexture(), none, { minVisibleFraction: 0.9, minVisibleParts: 6 }],
      ['big-min', customTexture(), custom, { minGeometrySize: 3.0 }],
      ['bench', benchTex, benchGeo, {}],
    ]
    const want = parseJSON(read('reports.json')) as JsonObject
    expect(want.entries.length).toBe(cases.length)
    for (const [name, tex, geo, opts] of cases) {
      const w = plain(want.get(name)) as Record<string, Record<string, unknown>>
      const skin = new Skin(tex, geo, opts)
      const report = w.Report!
      expect(JSON.parse(JSON.stringify(skin.report())), `${name}: report`).toEqual({ ...report, parts: nullAsEmpty(report.parts) })

      const vis = validateSkinVisibility(tex, geo, 0.3)
      expect(
        {
          IsInvisible: vis.isInvisible,
          Pass: vis.pass,
          Suspicious: vis.suspicious,
          Parts: vis.parts.map((p) => ({
            Name: p.name,
            Visible: p.visible,
            Fraction: p.fraction,
            Pixels: p.pixels,
            Transparent: p.transparent,
            FromGeo: p.fromGeo,
            Tiny: p.tiny,
          })),
          VisibleParts: vis.visibleParts,
          InvisibleParts: vis.invisibleParts,
        },
        `${name}: visibility`,
      ).toEqual({ ...w.Visibility, Parts: nullAsEmpty(w.Visibility!.Parts) })

      const size = validateGeometrySize(geo, 0)
      expect(
        { Pass: size.pass, Violations: size.violations.map((v) => ({ Bone: v.bone, Size: v.size, Minimum: v.minimum })) },
        `${name}: geometry size`,
      ).toEqual({ ...w.GeometrySize, Violations: nullAsEmpty(w.GeometrySize!.Violations) })

      expect(isSkinInvisible(tex), `${name}: isSkinInvisible`).toBe(w.IsInvisible)
      expect(isSkinTiny(geo), `${name}: isSkinTiny`).toBe(w.IsTiny)
      expect(skin.invisibleParts(), `${name}: invisible parts`).toEqual(nullAsEmpty(w.InvisibleList))
    }
  })
})

describe('geometry queries', () => {
  // testdata/parity/queries.json is what bedrock-skin-go picked out of each
  // file for each path.
  it('picks out what Go does', () => {
    const cases = plain(parseJSON(read('queries.json'))) as { File: string; Path: string; Values: unknown[] | null }[]
    for (const c of cases) {
      const tree = parseGeometryTree(read(c.File))
      const got = tree.select(c.Path).map((v) => ({ Path: v.path, Value: v.value }))
      expect(got, `${c.File} ${JSON.stringify(c.Path)}`).toEqual(nullAsEmpty(c.Values))
    }
  })

  it('reads values as types', () => {
    const tree = parseGeometryTree(
      '{"format_version":"1.12.0","minecraft:geometry":[{"description":{"identifier":"geometry.a"},"bones":[{"name":"rightArm","pivot":[-5,22,0],"cubes":[{"origin":[0,0,0],"size":[1,2,3],"uv":[0,0]}],"locators":{"lead":[1,2,3]}}]}]}',
    )
    expect(tree.formatVersion).toBe('1.12.0')
    expect(tree.identifiers()).toEqual(['geometry.a'])
    expect(tree.get('geometry.a/bones/rightArm/pivot')?.asNumbers()).toEqual([-5, 22, 0])
    expect(tree.get('geometry.a/bones/RIGHTARM')?.path).toBe('geometry.a/bones/rightArm')
    expect(tree.get('*/bones/0')?.bone()?.name).toBe('rightArm')
    expect(tree.get('*/bones/0/cubes/0')?.cube()?.size).toEqual([1, 2, 3])
    expect(tree.get('*/bones/0/locators/lead')?.locator()?.offset).toEqual([1, 2, 3])
    expect(tree.get('*/bones/0/name')?.asString()).toBe('rightArm')
    expect(tree.get('*/bones/0/cubes/0')?.json()).toBe('{"origin":[0,0,0],"size":[1,2,3],"uv":[0,0]}')
    expect(tree.geometries()[0]?.identifier).toBe('geometry.a')
    const odd = parseGeometryTree('{"geometry.b":{"bones":[{"name":"<a&b>","pivot":[-0,1e-7,1e21]}]}}')
    expect(odd.get('*/bones/0/name')?.json()).toBe('"\\u003ca\\u0026b\\u003e"')
    expect(odd.get('*/bones/0/pivot')?.json()).toBe('[-0,1e-7,1e+21]')
  })

  it('reports what it cannot read', () => {
    const code = (raw: string) => {
      try {
        parseGeometryTree(raw)
      } catch (e) {
        return e instanceof SkinError ? e.code : String(e)
      }
      return 'ok'
    }
    expect(code('{')).toBe('JSON')
    expect(code('[]')).toBe('GEOMETRY')
    expect(code('{"minecraft:geometry":[1]}')).toBe('GEOMETRY')
    expect(code('{}')).toBe('NO_GEOMETRY_MODELS')
    expect(code('null')).toBe('NO_GEOMETRY_MODELS')
  })
})

describe('wire skins', () => {
  const pixels = new Uint8Array(64 * 64 * 4).fill(255)

  it('decodes a skin as a client sends it', () => {
    const skin = decodeWireSkin({
      skinData: pixels,
      skinWidth: 64,
      skinHeight: 64,
      geometry: 'null',
      resourcePatch: '{"geometry":{"default":"geometry.humanoid.customSlim"}}',
      animations: [
        { animationType: 1, data: new Uint8Array(32 * 64 * 4), width: 32, height: 64 },
        { animationType: 9, data: new Uint8Array(4), width: 1, height: 1 },
      ],
    })
    expect(skin.identifier).toBe('geometry.humanoid.customSlim')
    expect(skin.geometry).toEqual([])
    expect(skin.animated.map((a) => a.type)).toEqual([1])
    expect(skinOptions(skin).texture).toBe(skin.texture)
  })

  it('keeps going past a bad resource patch, not bad pixels', () => {
    expect(decodeWireSkin({ skinData: pixels, skinWidth: 64, skinHeight: 64, resourcePatch: '{nope' }).identifier).toBe('')
    expect(() => decodeWireSkin({ skinData: pixels, skinWidth: 32, skinHeight: 64 })).toThrow(/skin: got/)
    expect(() => decodeWireSkin({ skinData: pixels, skinWidth: 64, skinHeight: 64, capeData: new Uint8Array(3) })).toThrow(SkinError)
    expect(() => decodeWireSkin({ skinData: pixels, skinWidth: 64, skinHeight: 64, geometry: '{nope' })).toThrow(SkinError)
  })

  it('hands the detector the texture and geometry', () => {
    expect(wireSkinDetector({ skinData: pixels, skinWidth: 64, skinHeight: 64, geometry: 'null' }).ok()).toBe(true)
    expect(wireSkinDetector({ skinData: new Uint8Array(64 * 64 * 4), skinWidth: 64, skinHeight: 64 }).isInvisible()).toBe(true)
  })
})
