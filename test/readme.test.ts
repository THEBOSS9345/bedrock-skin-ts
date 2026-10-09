// The examples in README.md, run, so it stays true.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANIMATED_FACE,
  armorSet,
  decodeImage,
  decodeWireSkin,
  encodePNG,
  exampleAnimations,
  Motion,
  parseAnimations,
  parseGeometry,
  parseGeometryTree,
  parseResourcePatch,
  prepareFrames,
  render,
  renderBytes,
  renderFrames,
  renderGIF,
  renderPNG,
  Skin,
  SkinError,
  skinOptions,
} from '../src/index'
import { armorTexture, faceTexture, itemTexture, read, testTexture } from './fixtures'

describe('README', () => {
  const texture = decodeImage(encodePNG(testTexture()))

  it('quick start', () => {
    expect(renderPNG({ texture }).length).toBeGreaterThan(0)
    const img = render({ texture, view: 'avatar', size: 128 })
    expect([img.width, img.height, img.data.length]).toEqual([128, 128, 128 * 128 * 4])
  })

  it('geometry', () => {
    const img = render({
      texture,
      geometry: parseGeometry(read('custom-geometry.json')),
      identifier: parseResourcePatch('{"geometry":{"default":"geometry.parity.custom"}}').default,
      size: 32,
    })
    expect(img.width).toBe(32)
  })

  it('armor and held items', () => {
    const img = render({
      texture,
      armor: armorSet(armorTexture(40), armorTexture(150)),
      rightHand: { item: itemTexture(16) },
      leftHand: { item: itemTexture(16), flat: true },
      size: 32,
    })
    expect(img.width).toBe(32)
  })

  it('animation', () => {
    expect(renderGIF({ texture, size: 32, animation: Motion.walk, fps: 4 }).length).toBeGreaterThan(0)
    const anims = parseAnimations(read('molang-test.animation.json'))
    expect(renderFrames({ texture, size: 16, animation: anims.get('animation.parity.molang')!, fps: 2 }).length).toBe(4)
    const bodyOnly = parseGeometry('{"minecraft:geometry":[{"description":{"identifier":"geometry.x"},"bones":[{"name":"body"}]}]}')[0]!
    expect(exampleAnimations().get('animation.player.dance')!.missingBones(bodyOnly)).toContain('head')
    const frames = prepareFrames({ texture, size: 64, animation: Motion.walk })
    expect(frames.draw(3, 32, { yaw: 90, pitch: 10 }).width).toBe(32)
  })

  it('packets', () => {
    const skin = decodeWireSkin({ skinData: testTexture().data as Uint8Array, skinWidth: 64, skinHeight: 64, geometry: 'null' })
    expect(renderPNG({ ...skinOptions(skin), view: 'avatar', size: 16 }).length).toBeGreaterThan(0)
  })

  it('geometry trees', () => {
    const tree = parseGeometryTree(read('custom-geometry.json'))
    expect(tree.get('geometry.parity.custom/bones/rightArm/pivot')?.asNumbers()).toEqual([-5, 22, 0])
    expect(tree.select('*/bones/*/cubes/*/size').length).toBe(10)
  })

  it('persona skins', () => {
    const geometry = parseGeometry(read('persona-mesh-geometry.json'))
    expect(render({ texture, geometry, animated: [{ type: ANIMATED_FACE, texture: faceTexture() }], view: 'head', size: 16 }).width).toBe(16)
    expect(render({ texture, geometry, size: 16 }).width).toBe(16)
    expect(() => render({ texture, geometry, view: 'head', size: 16 })).toThrow(expect.objectContaining({ code: 'EMPTY_VIEW' }))
  })

  it('detection and errors', () => {
    expect(new Skin(texture, undefined).report().verdict).toBe('ok')
    expect(JSON.parse(JSON.stringify(new Skin(texture).report()))).toHaveProperty('visible_parts', 6)
    try {
      renderBytes({ texture: new Uint8Array([1, 2]) })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SkinError)
      expect((e as SkinError).code).toBe('IMAGE')
    }
    expect(readFileSync('docs/images/walk.gif').subarray(0, 6).toString()).toBe('GIF89a')
  })
})
