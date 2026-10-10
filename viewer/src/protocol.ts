// What the page and the drawing engine say to each other. The engine runs in
// a Web Worker (worker.ts) or, where a worker cannot start, on the page
// (backend.ts); either way the messages are the same, and everything in them
// survives structured cloning.

import type { Scale } from 'bedrock-skin'

// An image as the engine takes it: a URL (already made absolute), the file's
// bytes, a Blob, an ImageBitmap, or raw RGBA pixels.
export type WireImage =
  | string
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap
  | { width: number; height: number; data: ArrayLike<number> & { buffer: ArrayBufferLike } }

// JSON as the engine takes it: a URL, or its text.
export type WireJSON = { url: string } | { text: string } | { bytes: ArrayBuffer | ArrayBufferView | Blob }

export interface WireHeld {
  item: WireImage
  flat?: boolean
  adjust?: { offset?: [number, number, number]; rotation?: [number, number, number]; scale?: number }
}

export interface WireSkin {
  texture?: WireImage
  geometry?: WireJSON
  model?: string
  resourcePatch?: WireJSON
  cape?: WireImage
  animated?: { type: 1 | 2 | 3; texture: WireImage }[]
  armor?: { helmet?: WireImage; chestplate?: WireImage; leggings?: WireImage; boots?: WireImage; elytra?: WireImage }
  rightHand?: WireHeld
  leftHand?: WireHeld
  scale?: Scale
  hideSkin?: boolean
}

// How bones move in one frame of an animation written in code: by bone
// name, rotation in degrees, position in model units, scale as a factor.
export type WirePose = [bone: string, move: { rotation?: [number, number, number]; position?: [number, number, number]; scale?: [number, number, number] }][]

// An animation: none (""), a built-in motion or example by name, one from a
// Bedrock animation file, or one written in code, its frames posed on the
// page.
export type WireAnimation = string | { file: WireJSON; name?: string } | { poses: WirePose[]; duration: number }

export interface WireCamera {
  yaw: number
  pitch: number
  margin: number
  fov?: number
}

// What a loaded skin and animation turned out to be.
export interface AnimationInfo {
  // How many frames one loop has, at fps; 1 for a model standing still.
  frames: number
  fps: number
  // The bones the animation moves that the model lacks: it was made for
  // another body, and those parts of it do nothing.
  missingBones: string[]
  // The animations in the file, when the animation came from one.
  fileAnimations: string[]
}

export type Request = { id: number; viewer: number } & (
  | { op: 'load'; seq: number; skinKey: string; skin: WireSkin; animKey: string; animation: WireAnimation; fps: number }
  // measure asks where the top of the model is, for a name tag.
  | { op: 'draw'; i: number; size: number; camera: WireCamera; measure?: boolean }
  | { op: 'png'; i: number; size: number; camera: WireCamera }
  | { op: 'list' }
  | { op: 'drop' }
)

export type Response = { id: number } & (
  | { ok: false; error: string }
  | { ok: true; stale: true }
  | { ok: true; info: AnimationInfo }
  // top is the topmost drawn pixel's row and the middle of that row's run,
  // each 0..1 across the picture, when measured and anything was drawn.
  | { ok: true; width: number; height: number; data: Uint8ClampedArray; top?: { x: number; y: number } }
  | { ok: true; png: Uint8Array }
  | { ok: true; motions: string[]; examples: string[] }
  | { ok: true }
)
