// Poses: how bones move from where the geometry puts them, and the built-in
// motions. See docs/animation.md in bedrock-skin-go.

import * as gomath from './gomath'
import { SkinError } from './errors'
import { compareBytes, sameBone, toLower } from './strings'

export type Vec3Tuple = readonly [number, number, number]

// BonePose is how one bone moves: rotation is added to the bone's own
// rotation (degrees, the geometry's convention), position to its offset
// from its parent (model units), and, when scaled, scale multiplies it
// (about its pivot, carrying its children; 0 hides it).
export interface BonePose {
  readonly rotation: Vec3Tuple
  readonly position: Vec3Tuple
  readonly scale: Vec3Tuple
  readonly scaled: boolean
}

const AT_REST: BonePose = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [0, 0, 0], scaled: false }

// bonePose fills in a BonePose: what is left out does not move, and giving
// a scale sets scaled.
export function bonePose(p: Partial<BonePose> = {}): BonePose {
  return {
    rotation: p.rotation ?? AT_REST.rotation,
    position: p.position ?? AT_REST.position,
    scale: p.scale ?? AT_REST.scale,
    scaled: p.scaled ?? p.scale !== undefined,
  }
}

// applyAfter is p with q applied after it: rotations and positions add, scales
// multiply.
export function applyAfter(p: BonePose, q: BonePose): BonePose {
  return {
    rotation: [p.rotation[0] + q.rotation[0], p.rotation[1] + q.rotation[1], p.rotation[2] + q.rotation[2]],
    position: [p.position[0] + q.position[0], p.position[1] + q.position[1], p.position[2] + q.position[2]],
    scale:
      p.scaled && q.scaled
        ? [p.scale[0] * q.scale[0], p.scale[1] * q.scale[1], p.scale[2] * q.scale[2]]
        : !p.scaled && q.scaled
          ? q.scale
          : p.scale,
    scaled: p.scaled || q.scaled,
  }
}

// Pose is a BonePose for each bone it moves, by name. Bones not in it stay
// at rest. A name matches a bone exactly, or failing that by its lower-case
// form, as animation files are matched in game.
export class Pose {
  private readonly bones: Map<string, BonePose>

  constructor(entries?: Iterable<readonly [string, BonePose]>) {
    this.bones = new Map(entries)
  }

  // set sets how a bone moves.
  set(bone: string, pose: BonePose): this {
    this.bones.set(bone, pose)
    return this
  }

  // of is the pose for a bone: the exact name, else the bone's name
  // lower-cased, else any name equal to it ignoring ASCII case - the
  // built-in motions say "leftArm" where persona models name the bone
  // "leftarm". When several names match that way the smallest wins.
  of(bone: string): BonePose {
    const exact = this.bones.get(bone)
    if (exact) return exact
    const lower = this.bones.get(toLower(bone))
    if (lower) return lower
    let best: [string, BonePose] | undefined
    for (const e of this.bones) {
      if (sameBone(e[0], bone) && (!best || compareBytes(e[0], best[0]) < 0)) best = e
    }
    return best ? best[1] : AT_REST
  }

  // entries are every bone's pose, in no particular order.
  entries(): IterableIterator<[string, BonePose]> {
    return this.bones.entries()
  }

  get size(): number {
    return this.bones.size
  }

  // with is a copy with each of extra applied after the pose this already
  // gives that bone. A bone's entry is found as of finds it and stored under
  // the name extra uses, so no other spelling of the name shadows it. extra
  // is applied in name order.
  with(extra: readonly (readonly [string, BonePose])[]): Pose {
    const out = new Pose(this.bones)
    const sorted = [...extra].sort((a, b) => compareBytes(a[0], b[0]))
    for (const [name, q] of sorted) {
      const bp = applyAfter(out.of(name), q)
      for (const other of [...out.bones.keys()]) if (sameBone(other, name)) out.bones.delete(other)
      out.bones.set(name, bp)
    }
    return out
  }
}

// Animator is anything that poses a model over time: a built-in Motion, or
// an Animation loaded from a Bedrock animation file.
export interface Animator {
  // duration is the length of one loop, in seconds.
  duration(): number
  // pose is the pose t seconds in.
  pose(t: number): Pose
}

// Motion is one of the built-in player animations: Minecraft's own
// movements, recreated as poses over time. They move bones by their
// standard names (head, body, rightArm, leftArm, rightLeg, leftLeg), so
// they work on any model that uses them, custom ones included.
export type MotionName = 'walk' | 'idle' | 'wave' | 'sneak'

export const MOTIONS: readonly MotionName[] = ['walk', 'idle', 'wave', 'sneak']

const rot = (r: Vec3Tuple) => bonePose({ rotation: r })
const forward = (deg: number) => rot([-deg, 0, 0])
const moved = (p: Vec3Tuple) => bonePose({ position: p })

export class Motion implements Animator {
  private constructor(readonly name: MotionName) {}

  // Arms and legs swing, each leg opposite its arm.
  static readonly walk = new Motion('walk')
  // The gentle breathing sway of an idle player.
  static readonly idle = new Motion('idle')
  // The right arm raised, waving.
  static readonly wave = new Motion('wave')
  // Leaning forward, creeping.
  static readonly sneak = new Motion('sneak')

  static readonly all: readonly Motion[] = [Motion.walk, Motion.idle, Motion.wave, Motion.sneak]

  duration(): number {
    return this.name === 'idle' ? 4.0 : this.name === 'sneak' ? 1.6 : 1.0
  }

  // Rotations follow the geometry's convention, in which a positive X turn
  // tips a bone's top toward the front: a limb hanging from its shoulder or
  // hip then swings backward, so swinging it forward is a negative X.
  // Raising an arm out to its side is a positive Z for the right arm,
  // negative for the left.
  pose(t: number): Pose {
    const phase = (2.0 * Math.PI * t) / this.duration()
    switch (this.name) {
      case 'walk': {
        // As animation.player.move.arms/legs: each arm opposite its leg, the
        // legs swinging 1.4 times as far.
        const arm = 40.0 * gomath.sin(phase)
        const leg = 56.0 * gomath.sin(phase)
        return new Pose([
          ['rightArm', forward(arm)],
          ['leftArm', forward(-arm)],
          ['rightLeg', forward(-leg)],
          ['leftLeg', forward(leg)],
        ])
      }
      case 'idle': {
        // Minecraft's idle bob: the arms drift out from the body and back,
        // up to 5.7 degrees.
        const out = 2.865 + 2.865 * gomath.cos(phase)
        return new Pose([
          ['rightArm', rot([0, 0, out])],
          ['leftArm', rot([0, 0, -out])],
        ])
      }
      case 'wave':
        return new Pose([['rightArm', rot([-10.0, 0, 150.0 + 20.0 * gomath.sin(phase)])]])
      case 'sneak': {
        // Minecraft's own sneak: the whole model leans forward from the feet
        // (root), set back to keep it balanced; the legs turn back against
        // the lean so they stay upright, and the body and head drop. The
        // legs also creep a short step.
        const step = 12.0 * gomath.sin(phase)
        return new Pose([
          ['root', bonePose({ rotation: [28.0, 0, 0], position: [0, 1.25, 9.0] })],
          ['body', moved([0, -2.0, 0])],
          ['head', moved([0, -1.0, 0])],
          ['rightArm', rot([-5.7, 0, 0])],
          ['leftArm', rot([-5.7, 0, 0])],
          ['rightLeg', rot([-28.0 - step, 0.1, 0.1])],
          ['leftLeg', rot([-28.0 + step, -0.1, -0.1])],
        ])
      }
    }
  }

  toString(): string {
    return this.name
  }
}

// parseMotion is the motion named s, exactly.
export function parseMotion(s: string): Motion {
  const m = Motion.all.find((m) => m.name === s)
  if (!m) throw new SkinError('UNKNOWN_MOTION', `unknown motion ${JSON.stringify(s)}`)
  return m
}
