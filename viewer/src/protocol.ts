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

// An animation: none (""), a built-in motion or example by name, or one from
// a Bedrock animation file.
export type WireAnimation = string | { file: WireJSON; name?: string }

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
  | { op: 'draw'; i: number; size: number; camera: WireCamera }
  | { op: 'png'; i: number; size: number; camera: WireCamera }
  | { op: 'list' }
  | { op: 'drop' }
)

export type Response = { id: number } & (
  | { ok: false; error: string }
  | { ok: true; stale: true }
  | { ok: true; info: AnimationInfo }
  | { ok: true; width: number; height: number; data: Uint8ClampedArray }
  | { ok: true; png: Uint8Array }
  | { ok: true; motions: string[]; examples: string[] }
  | { ok: true }
)
