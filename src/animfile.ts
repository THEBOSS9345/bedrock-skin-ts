// Bedrock animation files - what Blockbench exports and Minecraft's own
// resource packs use. See docs/animation.md#animation-files in
// bedrock-skin-go.

import { SkinError } from './errors'
import type { Geometry } from './geometry'
import * as gomath from './gomath'
import { JsonObject, JsonSyntaxError, parseJSON, type JsonValue } from './json'
import { Env, Molang, MolangError } from './molang'
import { bonePose, Pose, type Animator, type BonePose, type Vec3Tuple } from './pose'
import { compareBytes, toLower, trimSpace } from './strings'
import emotes from './generated/emotes.animation'
import fighting from './generated/fighting.animation'
import moves from './generated/moves.animation'

type Vec3Molang = readonly [Molang, Molang, Molang]

interface Keyframe {
  t: number
  pre: Vec3Molang
  post: Vec3Molang
  lerp: string // "linear", "catmullrom" or "step"
}

// A channel is one of a bone's rotation, position or scale: a value for all
// time (an expression per axis), or keyframes.
type Channel = { always: Vec3Molang } | { keys: Keyframe[] }

interface BoneAnimation {
  rotation?: Channel
  position?: Channel
  scale?: Channel
}

// The blocks a second the movement queries report: about a player walking,
// so a walk cycle driven by distance moved plays at its in-game pace.
const WALK_SPEED = 4.3

// Animation is one animation from a Bedrock animation file.
export class Animation implements Animator {
  // Whether it starts over at the end; holdOnLastFrame keeps the last pose
  // instead (as does not looping, once it has finished).
  looping = false
  holdOnLastFrame = false
  // How long it runs, in seconds: animation_length, or the last keyframe's
  // time when the file leaves it out.
  length = 0

  /** @internal */ timeUpdate: Molang | undefined
  // By lower-case bone name, so they match the geometry's bones
  // case-insensitively, as in game; in name order.
  /** @internal */ readonly boneAnims = new Map<string, BoneAnimation>()
  /** @internal */ readonly boneNames: string[] = []

  // name is its key in the file, e.g. animation.player.wave.
  constructor(readonly name: string) {}

  // bones are the bones the animation moves, as the file names them, sorted.
  bones(): string[] {
    return [...this.boneNames]
  }

  // missingBones are the bones the animation moves that g does not have, so
  // those parts of it will do nothing on that model - typically an animation
  // made for another entity (a wing, a tail). Names match
  // case-insensitively, as in game. Empty means every part of it applies.
  missingBones(g: Geometry): string[] {
    const have = new Set(g.bones.map((b) => toLower(b.name)))
    return this.boneNames.filter((n) => !have.has(toLower(n)))
  }

  // duration is its length, or a second for an animation with no keyframes
  // (all expressions), which has no natural end.
  duration(): number {
    return this.length > 0 ? this.length : 1
  }

  // pose is the pose t seconds in. Its clock is t, or what anim_time_update
  // makes of it, looped or held at the end as the file says.
  pose(t: number): Pose {
    const env = new Env()
    for (const [k, v] of [
      ['life_time', t],
      ['delta_time', 1.0 / 20.0],
      ['modified_distance_moved', t * WALK_SPEED],
      ['distance_moved', t * WALK_SPEED],
      ['walk_distance', t * WALK_SPEED],
      ['ground_speed', WALK_SPEED],
      ['modified_move_speed', 1],
      ['anim_speed', 1],
      ['is_on_ground', 1],
      ['is_alive', 1],
      ['health', 20],
      ['max_health', 20],
    ] as const) {
      env.queries.set(k, v)
    }
    let at = t
    if (this.timeUpdate) {
      env.queries.set('anim_time', t)
      at = this.timeUpdate.eval(env)
    }
    if (this.length > 0) {
      if (this.looping) {
        at %= this.length
        if (at < 0) at += this.length
      } else {
        // Played once, or held: the end pose stays.
        at = gomath.min(at, this.length)
      }
    }
    env.queries.set('anim_time', at)
    env.queries.set('anim_pos', at)

    const pose = new Pose()
    for (const [bone, ba] of this.boneAnims) {
      pose.set(
        bone,
        bonePose({
          rotation: ba.rotation && value(ba.rotation, at, env),
          position: ba.position && value(ba.position, at, env),
          scale: ba.scale && value(ba.scale, at, env),
        }),
      )
    }
    return pose
  }
}

const evalVec = (v: Vec3Molang, env: Env): Vec3Tuple => [v[0].eval(env), v[1].eval(env), v[2].eval(env)]

// value is the channel at time at: its expressions, or its keyframes
// interpolated. Before the first keyframe its value holds, as after the
// last.
function value(c: Channel, at: number, env: Env): Vec3Tuple {
  if ('always' in c) return evalVec(c.always, env)
  const keys = c.keys
  const first = keys[0]
  if (!first) return [0, 0, 0]
  if (at <= first.t) return evalVec(first.pre, env)
  const last = keys[keys.length - 1]!
  if (at >= last.t) return evalVec(last.post, env)
  let i = 0
  while (i + 1 < keys.length && keys[i + 1]!.t <= at) i++
  const k1 = keys[i]!
  const k2 = keys[i + 1]!
  const from = evalVec(k1.post, env)
  const to = evalVec(k2.pre, env)
  if (k1.lerp === 'step') return from
  const f = (at - k1.t) / (k2.t - k1.t)
  if (k1.lerp === 'catmullrom' || k2.lerp === 'catmullrom') {
    // Through the neighbouring keyframes; a missing one is its neighbour
    // repeated.
    const before = i > 0 ? evalVec(keys[i - 1]!.post, env) : from
    const after = i + 2 < keys.length ? evalVec(keys[i + 2]!.pre, env) : to
    return [0, 1, 2].map((ax) => catmullRom(before[ax]!, from[ax]!, to[ax]!, after[ax]!, f)) as unknown as Vec3Tuple
  }
  return [0, 1, 2].map((ax) => from[ax]! + (to[ax]! - from[ax]!) * f) as unknown as Vec3Tuple
}

// catmullRom is the uniform Catmull-Rom spline through p1 and p2 at t in
// 0..1, shaped by p0 and p3.
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t * t * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

// ---- reading ----

const fail = (msg: string): never => {
  throw new SkinError('ANIMATION', msg)
}

// field is an object's field as Go's decoder fills a struct: the last key
// equal to the name ignoring case.
function field(v: JsonObject, name: string): JsonValue | undefined {
  let out: JsonValue | undefined
  for (const [k, val] of v.entries) if (k.toLowerCase() === name) out = val
  return out
}

// entries are an object's entries as Go reads one into a map, a later key
// replacing an earlier one, in name order so every run reads them alike.
function entries(v: JsonObject): [string, JsonValue][] {
  const m = new Map<string, JsonValue>()
  for (const [k, val] of v.entries) m.set(k, val)
  return [...m].sort((a, b) => compareBytes(a[0], b[0]))
}

// parseAnimations reads a Bedrock animation file, returning its animations
// by name, in name order. Every Molang expression in it is compiled, so a
// syntax error is reported here, naming the animation, bone and channel it
// is in; names an expression reads that this library does not model are
// simply 0 when it runs. It throws a SkinError: NO_ANIMATIONS for a file
// with none, ANIMATION for one it cannot read.
export function parseAnimations(raw: Uint8Array | string): Map<string, Animation> {
  let doc: JsonValue
  try {
    doc = parseJSON(raw)
  } catch (e) {
    if (e instanceof JsonSyntaxError) fail(`animation file: ${e.message}`)
    throw e
  }
  if (doc !== null && !(doc instanceof JsonObject)) fail('animation file: not an object')
  const anims = doc instanceof JsonObject ? field(doc, 'animations') : undefined
  if (anims !== undefined && anims !== null && !(anims instanceof JsonObject)) {
    fail('animation file: "animations" is not an object')
  }
  const list = anims instanceof JsonObject ? entries(anims) : []
  if (list.length === 0) throw new SkinError('NO_ANIMATIONS', 'no animations in the file')
  return new Map(list.map(([name, v]) => [name, parseAnimation(name, v)]))
}

function parseAnimation(name: string, raw: JsonValue): Animation {
  const a = new Animation(name)
  if (raw === null) return a
  if (!(raw instanceof JsonObject)) return fail(`animation ${name}: not an object`)
  const loop = field(raw, 'loop')
  if (loop === true) a.looping = true
  else if (loop === 'hold_on_last_frame') a.holdOnLastFrame = true
  const length = field(raw, 'animation_length')
  if (length !== undefined && length !== null && typeof length !== 'number') {
    fail(`animation ${name}: animation_length is not a number`)
  }
  const tu = field(raw, 'anim_time_update')
  if (tu !== undefined) a.timeUpdate = compiled(() => molangValue(tu), `animation ${name}: anim_time_update`)
  let last = 0
  const bones = field(raw, 'bones')
  if (bones !== undefined && bones !== null && !(bones instanceof JsonObject)) fail(`animation ${name}: bones is not an object`)
  const anims: [string, BoneAnimation][] = []
  for (const [bone, rawBone] of bones instanceof JsonObject ? entries(bones) : []) {
    if (rawBone !== null && !(rawBone instanceof JsonObject)) fail(`animation ${name}, bone ${bone}: not an object`)
    const ba: BoneAnimation = {}
    for (const [chName, rawCh] of rawBone instanceof JsonObject ? entries(rawBone) : []) {
      const ch = compiled(() => parseChannel(rawCh), `animation ${name}, bone ${bone}, ${chName}`)
      if ('keys' in ch) {
        const k = ch.keys[ch.keys.length - 1]
        if (k) last = gomath.max(last, k.t)
      }
      switch (toLower(chName)) {
        case 'rotation':
          ba.rotation = ch
          break
        case 'position':
          ba.position = ch
          break
        case 'scale':
          ba.scale = ch
      }
    }
    anims.push([toLower(bone), ba])
    a.boneNames.push(bone)
  }
  // By lower-case name, the later of two spellings winning, as a map keyed
  // by it would have it.
  anims.sort((x, y) => compareBytes(x[0], y[0]))
  for (const [bone, ba] of anims) a.boneAnims.set(bone, ba)
  a.boneNames.sort(compareBytes)
  a.length = last
  if (typeof length === 'number' && length > 0) a.length = length
  return a
}

// compiled runs a step that reads part of the file, naming where in it a
// problem was.
function compiled<T>(f: () => T, where: string): T {
  try {
    return f()
  } catch (e) {
    if (e instanceof ValueError || e instanceof MolangError) return fail(`${where}: ${e.message}`)
    throw e
  }
}

class ValueError extends Error {}

// parseChannel reads a channel's value: a number, a string expression, an
// array of them, or an object of keyframes by time.
function parseChannel(raw: JsonValue): Channel {
  if (!(raw instanceof JsonObject)) return { always: parseVector(raw) }
  const keys: Keyframe[] = []
  for (const [ts, rawKey] of entries(raw)) {
    const t = parseGoFloat(trimSpace(ts))
    if (t === undefined) throw new ValueError(`keyframe time ${JSON.stringify(ts)} is not a number`)
    try {
      keys.push(parseKeyframe(t, rawKey))
    } catch (e) {
      if (e instanceof ValueError || e instanceof MolangError) throw new ValueError(`keyframe ${ts}: ${e.message}`)
      throw e
    }
  }
  keys.sort((a, b) => a.t - b.t)
  return { keys }
}

// parseGoFloat is Go's strconv.ParseFloat: a decimal number, Inf or NaN;
// undefined where Go reports an error, a number too big for a float64
// included.
function parseGoFloat(s: string): number | undefined {
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity
  if (/^nan$/i.test(s)) return NaN
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return undefined
  const v = Number(s)
  return Number.isFinite(v) ? v : undefined
}

function parseKeyframe(t: number, raw: JsonValue): Keyframe {
  if (!(raw instanceof JsonObject)) {
    const v = parseVector(raw)
    return { t, pre: v, post: v, lerp: 'linear' }
  }
  let lerp = 'linear'
  const mode = field(raw, 'lerp_mode')
  if (typeof mode === 'string') {
    if (mode !== '') lerp = toLower(mode)
  } else if (mode !== undefined && mode !== null) {
    throw new ValueError('lerp_mode is not a string')
  }
  const pre = field(raw, 'pre')
  const post = field(raw, 'post')
  if (pre !== undefined && post !== undefined) return { t, pre: parseVector(pre), post: parseVector(post), lerp }
  const one = post ?? pre
  if (one === undefined) throw new ValueError('a keyframe needs pre or post')
  const v = parseVector(one)
  return { t, pre: v, post: v, lerp }
}

// parseVector reads a value for three axes: an array of three numbers or
// expressions, or one value for all three (a number, a string, or a
// one-element array).
function parseVector(raw: JsonValue): Vec3Molang {
  if (Array.isArray(raw)) {
    switch (raw.length) {
      case 1: {
        const m = molangValue(raw[0]!)
        return [m, m, m]
      }
      case 3:
        return [molangValue(raw[0]!), molangValue(raw[1]!), molangValue(raw[2]!)]
      case 4:
        throw new ValueError('quaternion rotations are not supported; export Euler rotations from Blockbench')
    }
    throw new ValueError(`a value has ${raw.length} parts; want 1 or 3`)
  }
  const m = molangValue(raw)
  return [m, m, m]
}

// molangValue compiles a JSON number or string as an expression.
function molangValue(raw: JsonValue): Molang {
  // A number too big for a float64 is Go's "cannot unmarshal number".
  if (typeof raw === 'number' && Number.isFinite(raw)) return Molang.constant(raw)
  // Go reads null into a float64 as "no change": the constant 0.
  if (raw === null) return Molang.constant(0)
  if (typeof raw === 'string') {
    if (trimSpace(raw) === '') return Molang.constant(0)
    return Molang.compile(raw)
  }
  throw new ValueError(`a value must be a number or a Molang string, not ${describe(raw)}`)
}

const describe = (v: JsonValue) =>
  v instanceof JsonObject ? 'an object' : Array.isArray(v) ? 'an array' : typeof v === 'number' ? 'a number out of range' : String(v)

let examples: ReadonlyMap<string, Animation> | undefined

// exampleAnimations are the bundled example animations by name, e.g.
// animation.player.dance - emotes, moves and fighting, made for the player
// model. They are the same files as bedrock-skin-go's examples/animations,
// to read or load into Blockbench.
export function exampleAnimations(): ReadonlyMap<string, Animation> {
  if (!examples) {
    const all: [string, Animation][] = []
    for (const raw of [emotes, fighting, moves]) all.push(...parseAnimations(raw))
    examples = new Map(all.sort((a, b) => compareBytes(a[0], b[0])))
  }
  return examples
}
