// Moving skins: an animation drawn frame by frame. See docs/animation.md in
// bedrock-skin-go.

import * as gomath from './gomath'
import type { RgbaImage } from './image'
import type { Animator } from './pose'
import { ZERO, type Triangle, type Vec3 } from './raster'
import { boundingBox, cameraForBounds, framing, rasterize, scene, type RenderOptions, type Scene } from './render'
import type { Camera } from './view'

// AnimationOptions is what renderFrames draws: everything in RenderOptions
// (its pose is ignored), plus the animation and its timing.
export interface AnimationOptions extends RenderOptions {
  // What moves the model: a built-in Motion, or an Animation from a file.
  animation: Animator
  // Frames per second; 0 or unset means 20.
  fps?: number
  // How many frames to render; 0 or unset means one loop.
  frames?: number
}

// timing is the frame rate and frame count an animation is drawn at.
export function timing(opts: AnimationOptions): [fps: number, frames: number] {
  const fps = !opts.fps ? 20 : opts.fps
  const frames = !opts.frames ? Math.max(gomath.round(opts.animation.duration() * fps), 1) : opts.frames
  return [fps, frames]
}

// Frames is an animation prepared once: its per-frame scenes and the
// bounding box they share, kept so a viewer can draw frames one at a time as
// its own camera moves. renderFrames builds the same thing and draws every
// frame; Frames keeps it, so one frame costs one rasterization and every
// frame at one camera is framed the same way - root and whole-body motion
// stay on screen instead of the camera chasing each pose. A viewer that
// turns the model as it plays draws one frame a tick this way.
export class Frames {
  /** @internal */
  constructor(
    private readonly scenes: Scene[],
    // How many frames the animation has.
    readonly length: number,
    private readonly lo: Vec3,
    private readonly hi: Vec3,
    private readonly scale: number,
    private readonly flat: RgbaImage | undefined,
  ) {}

  // draw rasterizes frame i at a size-square image, using the camera the
  // frames were prepared with unless cam is set, when it refits the shared
  // framing to cam. Refitting is what turns a draw into an orbit: every
  // frame at one camera still shares a single framing. i wraps into range;
  // a size of 0 or unset means the prepared size. A persona skin's flat crop
  // is returned as prepared, whatever size was asked for.
  draw(i: number, size = 0, cam?: Camera): RgbaImage {
    if (this.flat) return copyImage(this.flat)
    const sc = this.scenes[0]!
    let { fov, margin, yaw, pitch } = sc
    if (cam) {
      if (cam.fov !== undefined && cam.fov > 0) fov = cam.fov
      if (cam.margin !== undefined && cam.margin > 0) {
        margin = cam.margin
        // scene() divides a camera's margin by the model scale, so a refit
        // has to as well or a scaled model frames differently. The prepared
        // margin is already divided.
        if (this.scale > 0) margin /= this.scale
      }
      yaw = cam.yaw ?? 0
      pitch = cam.pitch ?? 0
    }
    if (size === 0) size = sc.size
    const n = this.scenes.length
    const [eye, center] = cameraForBounds(this.lo, this.hi, fov, margin, yaw, pitch)
    return rasterize(this.scenes[((i % n) + n) % n]!.layers, eye, center, fov, size)
  }

  // all rasterizes every frame with the shared camera, as renderFrames does.
  all(): RgbaImage[] {
    const flat = this.flat
    if (flat) return Array.from({ length: this.length }, () => copyImage(flat))
    const sc = this.scenes[0]!
    const [eye, center] = cameraForBounds(this.lo, this.hi, sc.fov, sc.margin, sc.yaw, sc.pitch)
    return this.scenes.map((s) => rasterize(s.layers, eye, center, s.fov, s.size))
  }
}

const copyImage = (img: RgbaImage): RgbaImage => ({ width: img.width, height: img.height, data: img.data.slice() })

// prepareFrames builds every frame of an animation, and the one camera they
// share, without rasterizing anything. It is renderFrames split in two; draw
// the result with Frames.draw.
export function prepareFrames(opts: AnimationOptions): Frames {
  const [fps, frames] = timing(opts)
  const scale = opts.scale?.model ?? 0
  const scenes: Scene[] = []
  const sweep: Triangle[] = []
  for (let i = 0; i < frames; i++) {
    const sc = scene(opts, opts.animation.pose(i / fps))
    if (sc.flat) {
      // Geometry that draws nothing has nothing to move: every frame is the
      // flat crop.
      return new Frames([], frames, ZERO, ZERO, scale, sc.flat)
    }
    for (const t of framing(sc)) sweep.push(t)
    scenes.push(sc)
  }
  const [lo, hi] = boundingBox(sweep)
  return new Frames(scenes, frames, lo, hi, scale, undefined)
}

// renderFrames renders the animation frame by frame. Every frame shares one
// camera, fitted around the whole sweep, so the model moves within a still
// frame rather than the frame chasing it.
export function renderFrames(opts: AnimationOptions): RgbaImage[] {
  return prepareFrames(opts).all()
}
