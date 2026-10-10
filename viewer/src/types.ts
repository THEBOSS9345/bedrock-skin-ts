// The viewer's public types: what a skin, an animation and the options can
// be. Everything has a plain default, so `new SkinViewer(el, { skin: 'skin.png' })`
// is a whole viewer.

import type { ItemAdjust, RgbaImage, Scale } from 'bedrock-skin'
import type { WorkerOption } from './backend'

// ImageInput is an image, however you have it: a URL (relative ones are
// taken against the page), a File or Blob, the file's bytes, an <img>, a
// canvas, an ImageBitmap, ImageData, or raw RGBA pixels as bedrock-skin
// uses them. PNGs are read exactly as the game reads them; anything else
// (JPEG, WebP) by the browser.
export type ImageInput =
  | string
  | URL
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap
  | ImageData
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | RgbaImage

// JSONInput is a JSON file: a URL, its text, its bytes, a File or Blob, or
// the parsed object.
export type JSONInput = string | URL | Blob | ArrayBuffer | ArrayBufferView | object

// HeldInput is an item in a hand: its sprite (textures/items/*.png), or the
// sprite and how it is held.
export type HeldInput =
  | ImageInput
  | {
      item: ImageInput
      // Held as the game holds food and materials, not upright as a tool.
      flat?: boolean
      // Moves, turns or resizes it from where the game puts it.
      adjust?: ItemAdjust
    }

// ArmorInput is armor and an elytra, each piece its texture from a resource
// pack (textures/models/armor/*). layer1 and layer2 are a full set from the
// game's two files: layer 1 (helmet, chestplate, boots) and layer 2
// (leggings); a piece named on its own replaces the set's.
export interface ArmorInput {
  layer1?: ImageInput
  layer2?: ImageInput
  helmet?: ImageInput
  chestplate?: ImageInput
  leggings?: ImageInput
  boots?: ImageInput
  elytra?: ImageInput
}

// Skin is everything a player wears. Only texture is needed - or nothing at
// all, with hideSkin, to show equipment alone.
export interface Skin {
  // The skin image.
  texture?: ImageInput
  // A custom 3D model (geometry.json). Left out, the standard body.
  geometry?: JSONInput
  // Which body: 'wide' (Steve) or 'slim' (Alex), or a geometry entry's
  // identifier. Left out, the resource patch's, else the model with the most
  // cubes.
  model?: string
  // The skin's resource patch, which names its model, as the game sends it.
  resourcePatch?: JSONInput
  cape?: ImageInput
  // A persona skin's face: its animated face image, which textures its head.
  face?: ImageInput
  // A persona skin's animation images by type (1 face, 2 and 3 animated
  // body parts), as the game sends them.
  animated?: { type: 1 | 2 | 3; texture: ImageInput }[]
  armor?: ArmorInput
  rightHand?: HeldInput
  leftHand?: HeldInput
  // Resizes the figure (model) or any bone (parts: { head: 1.5 }).
  scale?: Scale
  // Draws the equipment without the skin.
  hideSkin?: boolean
}

// SkinInput is a skin, or just its image.
export type SkinInput = Skin | ImageInput

// BoneMove is how one bone moves from where the model puts it: rotation in
// degrees (x tips its top forward), position in model units (16 to a block),
// scale as a factor (one number for all three axes; 0 hides it).
export interface BoneMove {
  rotation?: [number, number, number]
  position?: [number, number, number]
  scale?: [number, number, number] | number
}

// CustomAnimation is an animation written in code: how each bone moves at a
// time into the loop, by the bone's name (head, body, rightArm, leftArm,
// rightLeg, leftLeg, or a custom model's own). pose is called once per frame
// when the animation is set, never while it plays, so it can take its time.
//
//   const nod = { duration: 1, pose: (t) => ({ head: { rotation: [Math.sin(t * 2 * Math.PI) * 20, 0, 0] } }) }
export interface CustomAnimation {
  // How long one loop is, in seconds.
  duration: number
  pose(time: number): Record<string, BoneMove>
}

// AnimationInput is what moves the model:
//   - null, '' or 'none': standing still
//   - 'walk', 'idle', 'wave' or 'sneak' (also 'crouch'): Minecraft's own
//   - an example's name: 'dance', 'backflip', 'animation.player.spin'...
//     (viewer.animations() lists them)
//   - { file, name }: one from a Bedrock animation file - what Blockbench
//     exports - by name, or the file's first
//   - a CustomAnimation: one written in code
export type AnimationInput = string | null | { file: JSONInput; name?: string } | CustomAnimation

// Background is what is behind the model; the default is transparent, so
// the page shows through.
//   - a string: any CSS background - '#202530', 'linear-gradient(...)',
//     "url(sky.png) center / cover"
//   - { image }: a picture, covering the viewer
//   - { panorama }: a wide picture that turns with the camera, a full circle
//     across its width
export type Background = string | { image: string; size?: 'cover' | 'contain' } | { panorama: string }

// NameTag is a name floating above the head, as in game: its text, or the
// text and how it looks. It is drawn in Minecraft's own font on a
// translucent dark box, and stays put while the model animates under it.
// Give a font to use ordinary text instead, styled further with CSS
// (.bsv-nametag, or ::part(nametag) on the element).
export type NameTag =
  | string
  | {
      text: string
      // CSS colours. Defaults: white on translucent black.
      color?: string
      background?: string
      // A CSS font family, instead of Minecraft's.
      font?: string
      // The text's height in CSS pixels. Default 16: 2 pixels to each of the
      // font's.
      size?: number
      // The space between the head and the tag, in CSS pixels. Default
      // about half a block, at the model's size on screen.
      gap?: number
    }

// Controls are how a person moves the camera. Each can be turned off.
export interface Controls {
  // Drag to turn round the model (mouse, touch or pen).
  rotate: boolean
  // Dragging up and down tilts the camera too.
  pitch: boolean
  // Wheel or pinch to zoom.
  zoom: boolean
  // Arrow keys turn and tilt, + and - zoom, once the viewer has focus.
  keyboard: boolean
  // A flick keeps turning, slowing to a stop.
  inertia: boolean
  // Double-click (or double-tap) puts the camera back.
  doubleClickReset: boolean
  // A person moving the camera stops auto-rotation.
  stopAutoRotate: boolean
  // Degrees turned per pixel dragged.
  rotateSpeed: number
  // How fast the wheel zooms; 1 is the default, 2 twice as fast.
  zoomSpeed: number
  // Turns the other way when dragged.
  invert: boolean
  // How far the camera tilts, in degrees.
  minPitch: number
  maxPitch: number
  // How far it zooms: 1 frames the whole model, 2 is twice as close.
  minZoom: number
  maxZoom: number
}

// Camera is where the camera is. yaw turns round the model (0 is in front;
// positive brings its left side into view), pitch tilts (positive looks
// down), zoom closes in (1 frames the whole model, at any animation pose).
export interface Camera {
  yaw: number
  pitch: number
  zoom: number
}

// View names a side to look from: setView('back').
export type View = 'front' | 'back' | 'left' | 'right' | 'iso'

export interface SkinViewerOptions {
  // The skin to show; set it later with setSkin.
  skin?: SkinInput | null
  // What moves it. Default: standing still.
  animation?: AnimationInput
  // Whether the animation plays. Default true.
  playing?: boolean
  // How fast it plays: 1 is normal, 0.5 half speed. Default 1.
  speed?: number
  // How many frames a second animations have, 1 to 60: more is smoother,
  // fewer lighter to prepare. Default 20, as the game's own tick.
  fps?: number
  // Where the camera starts. Default yaw 25, pitch 10, zoom 1.
  camera?: Partial<Camera>
  // The field of view, in degrees. Default 35.
  fov?: number
  // Turns the model on its own: true at 30 degrees a second, or a speed
  // (negative turns the other way). Default false.
  autoRotate?: boolean | number
  // How a person moves the camera: false for none, or the controls to change.
  controls?: boolean | Partial<Controls>
  // Device pixels drawn per CSS pixel. Default the screen's, at most 2.
  pixelRatio?: number
  // The largest picture drawn, in pixels square. Default 1024.
  maxResolution?: number
  // Draws only while the viewer is on screen and the tab visible. Default true.
  pauseWhenHidden?: boolean
  // Where drawing happens; see WorkerOption. Default 'auto'.
  worker?: WorkerOption
  // What screen readers say the viewer is. Default "Minecraft skin".
  label?: string
  // What is behind the model. Default transparent.
  background?: Background | null
  // A name above the head.
  nameTag?: NameTag | null
  // A fixed size, in CSS pixels (or any CSS length). Left out, the viewer
  // fills the element it is in, sized by your CSS.
  width?: number | string
  height?: number | string
}

export type { RgbaImage, Scale, ItemAdjust }
