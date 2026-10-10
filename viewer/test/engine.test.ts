import { readFileSync } from 'node:fs'
import { armorSet, decodeImage, exampleAnimations, Motion, parseGeometry, Pose, prepareFrames, type RenderOptions } from 'bedrock-skin'
import { describe, expect, it } from 'vitest'
import { handle } from '../src/engine'
import type { Request, Response, WireCamera } from '../src/protocol'

const ROOT = '../testdata'
const texture = readFileSync(`${ROOT}/bench-skin/texture.png`)
const geometry = readFileSync(`${ROOT}/bench-skin/geometry.json`)

let ids = 0
type Ask = Request extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never

async function ask(q: Ask): Promise<Response> {
  return (await handle({ ...q, id: ++ids } as Request)).res
}

const cam: WireCamera = { yaw: 40, pitch: 15, margin: 1.2 }

// sameAsLibrary checks a drawn frame against bedrock-skin drawing it itself.
function sameAsLibrary(res: Response, opts: RenderOptions & { animation: Parameters<typeof prepareFrames>[0]['animation']; fps: number }, i: number, size: number) {
  expect(res.ok).toBe(true)
  const want = prepareFrames(opts).draw(i, size, cam)
  const got = res as Extract<Response, { data: Uint8ClampedArray }>
  expect([got.width, got.height]).toEqual([want.width, want.height])
  expect(Buffer.from(got.data).equals(Buffer.from(want.data))).toBe(true)
}

describe('the engine', () => {
  it('draws what bedrock-skin draws', async () => {
    const load = await ask({ op: 'load', viewer: 1, seq: 1, skinKey: 'bench', skin: { texture, geometry: { bytes: geometry } }, animKey: 'walk', animation: 'walk', fps: 10 })
    expect(load).toMatchObject({ ok: true, info: { frames: 10, fps: 10, missingBones: [] } })
    const draw = await ask({ op: 'draw', viewer: 1, i: 3, size: 128, camera: cam })
    sameAsLibrary(draw, { texture: decodeImage(texture), geometry: parseGeometry(geometry), animation: Motion.walk, fps: 10 }, 3, 128)
  })

  it('wears armor and holds items', async () => {
    const tex = readFileSync(`${ROOT}/golden/avatar.png`)
    const skin = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(200) }
    const load = await ask({
      op: 'load',
      viewer: 2,
      seq: 1,
      skinKey: 'armored',
      skin: { texture: skin, model: 'slim', armor: { helmet: tex, chestplate: tex }, rightHand: { item: tex, flat: true } },
      animKey: 'still',
      animation: '',
      fps: 20,
    })
    expect(load).toMatchObject({ ok: true, info: { frames: 1 } })
    const draw = await ask({ op: 'draw', viewer: 2, i: 0, size: 96, camera: cam })
    const img = decodeImage(tex)
    sameAsLibrary(
      draw,
      {
        texture: { width: 64, height: 64, data: skin.data },
        identifier: 'geometry.humanoid.customSlim',
        armor: { ...armorSet(img, img), leggings: undefined, boots: undefined },
        rightHand: { item: img, flat: true },
        animation: { duration: () => 0, pose: () => new Pose() },
        fps: 20,
      },
      0,
      96,
    )
  })

  it('plays examples and animation files, and names missing bones', async () => {
    const dance = await ask({ op: 'load', viewer: 3, seq: 1, skinKey: 'bench', skin: { texture, geometry: { bytes: geometry } }, animKey: 'dance', animation: 'dance', fps: 5 })
    expect(dance).toMatchObject({ ok: true, info: { frames: Math.round(exampleAnimations().get('animation.player.dance')!.duration() * 5) } })
    const file = JSON.stringify({ animations: { 'animation.tail.wag': { loop: true, animation_length: 1, bones: { tail: { rotation: [0, 'math.sin(q.anim_time * 360) * 30', 0] } } } } })
    const wag = await ask({ op: 'load', viewer: 3, seq: 2, skinKey: 'bench', skin: { texture }, animKey: 'wag', animation: { file: { text: file } }, fps: 4 })
    expect(wag).toMatchObject({ ok: true, info: { frames: 4, missingBones: ['tail'], fileAnimations: ['animation.tail.wag'] } })
    const crouch = await ask({ op: 'load', viewer: 3, seq: 3, skinKey: 'bench', skin: { texture }, animKey: 'crouch', animation: 'crouch', fps: 5 })
    expect(crouch).toMatchObject({ ok: true, info: { frames: 8 } })
  })

  it('says what went wrong', async () => {
    const bad = async (skin: object, animation: unknown = '') =>
      ((await ask({ op: 'load', viewer: 4, seq: ++ids, skinKey: String(ids), skin, animKey: String(ids), animation: animation as string, fps: 20 })) as { error?: string }).error
    expect(await bad({})).toMatch(/no skin texture/)
    expect(await bad({ texture: new Uint8Array([1, 2, 3]) })).toMatch(/^skin: /)
    expect(await bad({ texture }, 'moonwalk')).toMatch(/no animation named "moonwalk"/)
    expect(await bad({ texture, geometry: { text: '{nope' } })).toMatch(/JSON|json/)
    expect(await bad({ texture }, { file: { text: '{"animations":{"a":{}}}' }, name: 'b' })).toMatch(/has no animation "b"/)
    expect((await ask({ op: 'draw', viewer: 99, i: 0, size: 32, camera: cam })) as object).toMatchObject({ ok: false, error: 'nothing loaded' })
  })

  it('drops a load overtaken by a newer one', async () => {
    const slow = ask({ op: 'load', viewer: 5, seq: 1, skinKey: 'bench', skin: { texture }, animKey: 'a', animation: 'walk', fps: 5 })
    const fast = ask({ op: 'load', viewer: 5, seq: 2, skinKey: 'bench', skin: { texture }, animKey: 'b', animation: '', fps: 5 })
    expect(await slow).toMatchObject({ ok: true, stale: true })
    expect(await fast).toMatchObject({ ok: true, info: { frames: 1 } })
  })

  it('lists the animations, and makes PNGs', async () => {
    const list = (await ask({ op: 'list', viewer: 1 })) as { motions: string[]; examples: string[] }
    expect(list.motions).toEqual(['walk', 'idle', 'wave', 'sneak'])
    expect(list.examples).toHaveLength(33)
    const png = (await ask({ op: 'png', viewer: 1, i: 0, size: 64, camera: cam })) as { png: Uint8Array }
    expect(decodeImage(png.png).width).toBe(64)
  })
})
