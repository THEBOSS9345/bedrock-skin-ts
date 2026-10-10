import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { armorSet, type Armor, type Held } from '../src/equipment'
import { Motion, Pose, bonePose } from '../src/pose'
import { ANIMATED_BODY_128, ANIMATED_FACE, render, renderItem, type ItemOptions, type RenderOptions } from '../src/render'
import type { Camera } from '../src/view'
import {
  armorTexture,
  bench,
  customTexture,
  DIR,
  faceTexture,
  itemTexture,
  legacyTexture,
  parsed,
  read,
  sameImage,
  semiTexture,
  testTexture,
} from './fixtures'

const cam = (yaw: number, pitch: number, fov: number, margin: number): Camera => ({ yaw, pitch, fov, margin })

describe('render', () => {
  // testdata/golden is bedrock-skin-go's own golden renders.
  it('matches the Go golden renders', () => {
    const tex = testTexture()
    const base = (o: Partial<RenderOptions>): RenderOptions => ({ texture: tex, size: 96, ...o })
    const cases: [string, RenderOptions][] = [
      ['body-front', base({ view: 'body', angle: 'front' })],
      ['body-iso', base({ view: 'body', angle: 'iso' })],
      ['chest-front', base({ view: 'chest' })],
      ['head-default', base({ view: 'head' })],
      ['avatar', base({ view: 'avatar' })],
      ['slim', base({ identifier: 'geometry.humanoid.customSlim' })],
      ['body-cape', base({ cape: tex })],
      ['parts-head-arm', base({ parts: ['head', 'leftArm'] })],
      ['camera-explicit', base({ camera: { yaw: 200, pitch: -15, fov: 50, margin: 1.2 } })],
    ]
    for (const [name, opts] of cases) sameImage(name, render(opts), readFileSync(`testdata/golden/${name}.png`))
  })

  // testdata/parity/renders holds what bedrock-skin-go drew for each of
  // these, made by tools/parity from the same inputs.
  it('matches every Go render', () => {
    const { texture: benchTex, geometry: benchGeo } = bench()
    const test = testTexture()
    const semi = semiTexture()
    const custom = customTexture()
    const legacyTex = legacyTexture()
    const customGeo = parsed('custom-geometry.json')
    const personaGeo = parsed('persona-geometry.json')
    const legacyGeo = parsed('legacy-geometry.json')
    const meshGeo = parsed('persona-mesh-geometry.json')
    const oddGeo = parsed('persona-mesh-odd.json')
    const companionGeo = parsed('persona-companion-geometry.json')
    const face = faceTexture()
    const scaled = () =>
      new Pose([
        ['head', bonePose({ scale: [1.5, 1.5, 1.5], rotation: [0, 30, 0] })],
        ['rightarm', bonePose({ scale: [0, 0, 0] })],
        ['leftLeg', bonePose({ position: [0, 2, -3], rotation: [-40, 0, 0] })],
      ])
    const faceAnim = [{ type: ANIMATED_FACE, texture: face }]

    const [a40, a150, a200, a90, a220] = [40, 150, 200, 90, 220].map(armorTexture) as [ReturnType<typeof armorTexture>, ...ReturnType<typeof armorTexture>[]]
    const item16 = itemTexture(16)
    const item24 = itemTexture(24)
    const diamond = armorSet(a40, a150!)
    const winged: Armor = { ...diamond, elytra: a220 }
    const sword: Held = { item: item16 }
    const flat: Held = { item: item16, flat: true }

    const cases: [string, RenderOptions][] = [
      ['bench-body-iso', { texture: benchTex, geometry: benchGeo, angle: 'iso', size: 128 }],
      ['bench-avatar', { texture: benchTex, geometry: benchGeo, view: 'avatar', size: 100 }],
      ['bench-cape', { texture: benchTex, geometry: benchGeo, cape: test, size: 120 }],
      ['bench-chest-camera', { texture: benchTex, geometry: benchGeo, view: 'chest', camera: cam(-40, 10, 0, 0), size: 90 }],
      ['custom-body', { texture: custom, geometry: customGeo, angle: 'iso', size: 128 }],
      ['custom-back', { texture: custom, geometry: customGeo, camera: cam(160, 30, 0, 0), cape: test, size: 100 }],
      ['custom-head', { texture: custom, geometry: customGeo, view: 'head', size: 80 }],
      ['custom-parts', { texture: custom, geometry: customGeo, parts: ['tail', 'horn'], size: 64 }],
      ['semi-body', { texture: semi, angle: 'iso', size: 96 }],
      ['close-camera', { texture: test, camera: cam(30, 20, 70, 0.35), size: 96 }],
      ['inside-camera', { texture: test, camera: cam(180, -5, 90, 0.1), size: 96 }],
      ['persona-body', { texture: semi, geometry: personaGeo, size: 100 }],
      ['persona-chest', { texture: semi, geometry: personaGeo, view: 'chest', size: 77 }],
      ['persona-head', { texture: semi, geometry: personaGeo, view: 'head', size: 64 }],
      ['persona-avatar-8', { texture: semi, geometry: personaGeo, view: 'avatar', size: 8 }],
      ['persona-128', { texture: custom, geometry: personaGeo, size: 50 }],
      ['legacy-body', { texture: test, geometry: legacyGeo, size: 64 }],
      ['legacy-alpha', { texture: legacyTex, geometry: legacyGeo, identifier: 'geometry.alpha', size: 64 }],
      ['sneak-still', { texture: test, pose: Motion.sneak.pose(0.4), size: 96 }],
      ['scaled-pose', { texture: test, pose: scaled(), angle: 'iso', size: 96 }],
      ['tiny', { texture: test, view: 'avatar', size: 3 }],
      ['mesh-body', { texture: test, geometry: meshGeo, size: 96 }],
      ['mesh-face-iso', { texture: test, geometry: meshGeo, animated: faceAnim, angle: 'iso', size: 96 }],
      ['mesh-face-head', { texture: test, geometry: meshGeo, animated: faceAnim, view: 'head', size: 80 }],
      ['mesh-face-avatar', { texture: semi, geometry: meshGeo, animated: faceAnim, view: 'avatar', size: 64 }],
      ['mesh-face-chest', { texture: test, geometry: meshGeo, animated: faceAnim, view: 'chest', cape: semi, size: 72 }],
      ['mesh-face-back', { texture: test, geometry: meshGeo, animated: faceAnim, cape: semi, camera: { yaw: 150, pitch: 20 }, size: 96 }],
      ['mesh-parts-hat', { texture: test, geometry: meshGeo, animated: faceAnim, parts: ['HAT', 'leftArm'], size: 64 }],
      ['mesh-odd', { texture: test, geometry: oddGeo, angle: 'iso', size: 96 }],
      ['mesh-odd-head', { texture: semi, geometry: oddGeo, view: 'head', size: 64 }],
      ['mesh-odd-chest', { texture: test, geometry: oddGeo, view: 'chest', size: 64 }],
      [
        'mesh-companion',
        {
          texture: test,
          geometry: companionGeo,
          animated: [
            { type: ANIMATED_BODY_128, texture: semi },
            { type: ANIMATED_FACE, texture: face },
          ],
          angle: 'iso',
          size: 96,
        },
      ],
      ['armor-iso', { texture: test, armor: diamond, angle: 'iso', size: 96 }],
      ['armor-back', { texture: semi, armor: diamond, cape: test, camera: cam(160, 25, 0, 0), size: 96 }],
      ['armor-mixed-slim', { texture: test, identifier: 'geometry.humanoid.customSlim', armor: { helmet: a200, boots: a90 }, angle: 'iso', size: 80 }],
      ['armor-avatar', { texture: test, armor: diamond, rightHand: sword, view: 'avatar', size: 64 }],
      ['armor-chest', { texture: test, armor: diamond, rightHand: sword, leftHand: flat, view: 'chest', size: 72 }],
      ['elytra-back', { texture: test, armor: winged, camera: cam(170, 15, 0, 0), size: 96 }],
      ['elytra-side', { texture: semi, armor: winged, rightHand: sword, camera: cam(-70, -20, 0, 0), size: 96 }],
      ['held-side', { texture: test, rightHand: sword, camera: cam(-70, 10, 0, 0), size: 96 }],
      ['held-24', { texture: semi, rightHand: { item: item24 }, angle: 'iso', size: 96 }],
      ['held-left', { texture: test, leftHand: sword, camera: cam(60, 10, 0, 0), size: 96 }],
      ['held-both-flat', { texture: test, rightHand: flat, leftHand: { item: item24, flat: true }, angle: 'iso', size: 96 }],
      [
        'held-adjust',
        {
          texture: test,
          rightHand: { item: item16, adjust: { offset: [0.5, 2.0, -1.25], rotation: [37, -20, 11], scale: 1.3 } },
          leftHand: { item: item16, flat: true, adjust: { rotation: [0, 90, 0], scale: 0.7 } },
          camera: cam(-35, 15, 0, 0),
          size: 96,
        },
      ],
      ['held-slim', { texture: test, identifier: 'geometry.humanoid.customSlim', rightHand: sword, leftHand: sword, pose: Motion.wave.pose(0.3), size: 80 }],
      ['held-parts', { texture: test, rightHand: sword, leftHand: sword, armor: diamond, parts: ['rightArm'], size: 64 }],
      ['held-custom', { texture: custom, geometry: customGeo, armor: winged, rightHand: sword, leftHand: sword, angle: 'iso', size: 96 }],
      ['held-mesh', { texture: test, geometry: meshGeo, animated: faceAnim, armor: diamond, rightHand: sword, leftHand: flat, angle: 'iso', size: 96 }],
      [
        'scale-parts',
        {
          texture: test,
          armor: diamond,
          rightHand: sword,
          scale: { parts: { HEAD: 1.6, rightarm: 1.3, leftLeg: 0.0, Body: 0.9 } },
          pose: scaled(),
          angle: 'iso',
          size: 96,
        },
      ],
      ['scale-model-big', { texture: test, armor: winged, rightHand: sword, scale: { model: 1.7 }, angle: 'iso', size: 80 }],
      ['scale-model-small', { texture: semi, scale: { model: 0.45 }, camera: cam(20, 5, 0, 1.1), size: 80 }],
      ['solo-armor', { hideSkin: true, armor: winged, rightHand: sword, angle: 'iso', size: 96 }],
      ['solo-helmet', { hideSkin: true, armor: diamond, view: 'head', size: 64 }],
      ['solo-hand', { hideSkin: true, leftHand: flat, camera: cam(50, 10, 0, 0), size: 64 }],
      ['solo-cape-parts', { hideSkin: true, cape: test, armor: diamond, parts: ['cape', 'leftLeg'], size: 64 }],
    ]
    const items: [string, ItemOptions][] = [
      ['item-front', { item: item16, size: 64 }],
      ['item-iso', { item: item24, angle: 'iso', size: 80 }],
      ['item-camera', { item: item16, camera: cam(130, -25, 50, 1.4), size: 72 }],
      ['item-adjust', { item: item16, adjust: { offset: [3, -1, 2], rotation: [20, 33, -45], scale: 2.5 }, size: 64 }],
    ]
    const failures: string[] = []
    const check = (name: string, draw: () => ReturnType<typeof render>) => {
      try {
        sameImage(name, draw(), read(`renders/${name}.png`))
      } catch (e) {
        failures.push(e instanceof Error ? e.message.split('\n')[0]! : String(e))
      }
    }
    for (const [name, opts] of cases) check(name, () => render(opts))
    for (const [name, opts] of items) check(name, () => renderItem(opts))
    expect(readdirSync(`${DIR}/renders`).length, 'every Go render is checked').toBe(cases.length + items.length)
    expect(failures).toEqual([])
  })
})

// A chestplate reaches further back than a cape rests, so a cape left in place
// was drawn inside it and hidden. Seen from behind, it must show as much over
// a chestplate as without one.
it('hangs a cape outside the chestplate', () => {
  const cape = { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4).map((_, i) => [230, 0, 0, 255][i % 4] ?? 0) }
  const red = (img: { data: ArrayLike<number> }) => {
    let n = 0
    for (let i = 0; i < img.data.length; i += 4) {
      const [r, g, b, a] = [0, 1, 2, 3].map((k) => img.data[i + k] ?? 0) as [number, number, number, number]
      if (a > 0 && r > g + 100 && r > b + 100) n++
    }
    return n
  }
  const base: RenderOptions = { texture: testTexture(), cape, camera: { yaw: 180, pitch: 0 }, size: 96 }
  const bare = red(render(base))
  const armored = red(render({ ...base, armor: { chestplate: armorTexture(40) } }))
  expect(bare).toBeGreaterThan(0)
  expect(armored * 10).toBeGreaterThanOrEqual(bare * 9)
})
