import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exampleAnimations, parseAnimations } from '../src/animfile'
import { armorSet, type Armor, type Held } from '../src/equipment'
import { renderFrames, type AnimationOptions } from '../src/frames'
import { float64Bits } from '../src/gomath'
import { JsonObject, parseJSON, type JsonValue } from '../src/json'
import { Env, Molang } from '../src/molang'
import { Motion, parseMotion, type Animator } from '../src/pose'
import { ANIMATED_FACE, renderItemFrames } from '../src/render'
import { SkinError } from '../src/errors'
import { armorTexture, customTexture, DIR, faceTexture, itemTexture, parsed, read, sameImage, testTexture } from './fixtures'

const evalMolang = (src: string) => {
  const env = new Env()
  env.queries.set('anim_time', 0.5)
  return Molang.compile(src).eval(env)
}

describe('molang', () => {
  it('evaluates expressions', () => {
    const cases: [string, number][] = [
      ['1 + 2 * 3', 7],
      ['(1 + 2) * 3', 9],
      ['q.anim_time * 2', 1],
      ['Math.Sin(90)', 1],
      ['1 > 2 ? 5 : 6', 6],
      ['0 ? 5', 0],
      ['v.x = 3; v.y = v.x * 2; return v.y + 1;', 7],
      ['1 / 0', 0],
      ['-2 - -3', 1],
      ['1.5f * 2', 3],
      ['query.unknown ?? 4', 0],
      ['math.clamp(5, 0, 2)', 2],
      ['!0 && 1', 1],
      ['math.round(-2.5)', -3],
    ]
    for (const [src, want] of cases) expect(evalMolang(src), src).toBe(want)
  })

  it('reports syntax errors', () => {
    for (const src of ['1 +', 'math.nope(1)', '(1', '1 $ 2', 'f(1', '1.2.3']) {
      expect(() => Molang.compile(src), src).toThrow(/molang/)
    }
  })
})

const anims = parseAnimations(read('molang-test.animation.json'))
const examples = exampleAnimations()

function animator(name: string): Animator {
  for (const m of Motion.all) if (m.name === name) return m
  const a = anims.get(name) ?? examples.get(name)
  if (!a) throw new Error(`no animation ${name}`)
  return a
}

const bits = (v: readonly number[]) => v.map((f) => float64Bits(f).toString(16))

describe('animation files', () => {
  // testdata/parity/poses.json is what bedrock-skin-go posed each animation
  // as at each time, compared bit for bit.
  it('poses every animation as Go does', () => {
    const cases = parseJSON(read('poses.json')) as JsonValue[]
    let n = 0
    for (const c of cases) {
      const o = c as JsonObject
      const name = o.get('Animation') as string
      const t = o.get('T') as number
      const pose = animator(name).pose(t)
      const want = o.get('Pose')
      const wantBones = want instanceof JsonObject ? want.entries : []
      expect(pose.size, `${name} at ${t}: bones`).toBe(wantBones.length)
      const got = new Map(pose.entries())
      for (const [bone, w] of wantBones) {
        const g = got.get(bone)
        expect(g, `${name} at ${t}: no ${bone}`).toBeDefined()
        const wo = w as JsonObject
        const vec = (k: string) => bits(wo.get(k) as number[])
        expect(
          [bits(g!.rotation), bits(g!.position), bits(g!.scale), g!.scaled],
          `${name} at ${t}, ${bone}: ${JSON.stringify(g)}`,
        ).toEqual([vec('Rotation'), vec('Position'), vec('Scale'), wo.get('Scaled')])
      }
      n++
    }
    expect(n).toBeGreaterThan(200)
  })

  it('lists bones and the ones a model lacks', () => {
    const a = anims.get('animation.parity.molang')!
    expect(a.bones()).toEqual(['Tail', 'body', 'head', 'leftArm', 'leftLeg', 'rightArm', 'rightLeg'])
    expect(a.missingBones(parsed('custom-geometry.json')[0]!)).not.toContain('head')
    expect(a.looping).toBe(true)
    expect(a.duration()).toBe(2)
    const tu = anims.get('animation.parity.timeupdate')!
    expect([tu.holdOnLastFrame, tu.looping, tu.length]).toEqual([true, false, 1.5])
  })

  it('reports what it cannot read', () => {
    const code = (raw: string) => {
      try {
        parseAnimations(raw)
      } catch (e) {
        return e instanceof SkinError ? e.code : String(e)
      }
      return 'ok'
    }
    expect(code('{}')).toBe('NO_ANIMATIONS')
    expect(code('{"animations":{}}')).toBe('NO_ANIMATIONS')
    expect(code('null')).toBe('NO_ANIMATIONS')
    expect(code('{')).toBe('ANIMATION')
    expect(code('[]')).toBe('ANIMATION')
    expect(code('{"animations":{"a":{"bones":{"head":{"rotation":"1 +"}}}}}')).toBe('ANIMATION')
    expect(code('{"animations":{"a":{"bones":{"head":{"rotation":[1,2,3,4]}}}}}')).toBe('ANIMATION')
    expect(code('{"animations":{"a":{"bones":{"head":{"rotation":{"x":[1,2,3]}}}}}}')).toBe('ANIMATION')
    expect(code('{"animations":{"a":{"bones":{"head":{"rotation":{"0":{"lerp_mode":"step"}}}}}}}')).toBe('ANIMATION')
    expect(code('{"Animations":{"a":{"bones":{"head":{"rotation":[1,"q.anim_time",3]}}}}}')).toBe('ok')
  })

  it('bundles the example animations', () => {
    expect(examples.size).toBe(33)
    expect(examples.has('animation.player.dance')).toBe(true)
    expect(parseMotion('walk')).toBe(Motion.walk)
  })
})

describe('frames', () => {
  // testdata/parity/frames holds what bedrock-skin-go drew for each frame.
  it('matches every Go frame', () => {
    const test = testTexture()
    const custom = customTexture()
    let checked = 0
    const check = (name: string, opts: AnimationOptions) => {
      const frames = renderFrames(opts)
      frames.forEach((f, i) => {
        const id = `${name}-${String(i).padStart(2, '0')}`
        sameImage(id, f, read(`frames/${id}.png`))
      })
      expect(existsSync(`${DIR}/frames/${name}-${String(frames.length).padStart(2, '0')}.png`), `${name}: frame count`).toBe(false)
      checked += frames.length
    }
    for (const m of Motion.all) check(m.name, { texture: test, size: 64, animation: m, fps: 6 })
    for (const n of ['dance', 'backflip', 'jumping_jacks', 'spin', 'sword_swing', 'zombie_walk', 'levitate', 'sit', 'swim', 'airplane']) {
      check(n, { texture: test, size: 64, animation: examples.get(`animation.player.${n}`)!, fps: 6 })
    }
    check('mesh-walk', {
      texture: test,
      geometry: parsed('persona-mesh-geometry.json'),
      animated: [{ type: ANIMATED_FACE, texture: faceTexture() }],
      angle: 'iso',
      size: 64,
      animation: Motion.walk,
      fps: 4,
    })
    check('molang', {
      texture: custom,
      geometry: parsed('custom-geometry.json'),
      angle: 'iso',
      size: 72,
      animation: anims.get('animation.parity.molang')!,
      fps: 5,
    })
    const item16 = itemTexture(16)
    const winged: Armor = { ...armorSet(armorTexture(40), armorTexture(150)), elytra: armorTexture(220) }
    const right: Held = { item: item16 }
    const equipped = {
      texture: test,
      armor: winged,
      rightHand: right,
      leftHand: { item: item16, flat: true, adjust: { rotation: [10, 0, 0] } } as Held,
      angle: 'iso' as const,
      size: 64,
    }
    check('armored-walk', { ...equipped, animation: Motion.walk, fps: 4 })
    check('armored-sneak', { ...equipped, animation: Motion.sneak, fps: 4 })
    check('solo-walk', { hideSkin: true, armor: winged, rightHand: right, angle: 'iso', size: 64, animation: Motion.walk, fps: 4 })

    const spin = renderItemFrames({
      item: item16,
      camera: { yaw: 0, pitch: 15 },
      adjust: { rotation: [0, 0, 20] },
      size: 48,
      duration: 1.5,
      fps: 4,
    })
    spin.forEach((f, i) => {
      const id = `item-spin-${String(i).padStart(2, '0')}`
      sameImage(id, f, read(`frames/${id}.png`))
    })
    expect(existsSync(`${DIR}/frames/item-spin-${String(spin.length).padStart(2, '0')}.png`)).toBe(false)
    checked += spin.length
    expect(checked).toBe(readdirSync(`${DIR}/frames`).length)
  })
})
