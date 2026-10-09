// Rendering from encoded files to encoded files: PNG textures in, PNG or
// GIF out - what an HTTP handler or a bot has to hand.

import { SkinError } from './errors'
import type { Armor, Held, ItemAdjust } from './equipment'
import { prepareFrames, renderFrames, timing, type AnimationOptions } from './frames'
import { isEmpty, parseGeometry } from './geometry'
import { encodeGIF } from './gif'
import { newImage, type RgbaImage } from './image'
import { decodePNG, encodePNG, isPNG, pngDimensions } from './png'
import type { Animator } from './pose'
import {
  render,
  renderItem,
  renderItemFrames,
  type AnimatedType,
  type ItemAnimationOptions,
  type ItemOptions,
  type RenderOptions,
} from './render'

const isJPEG = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

// decodeImage decodes a PNG to RGBA pixels. Skins, capes, armor and items
// are PNGs; a JPEG is refused with a SkinError saying so, rather than drawn
// with a decoder that would not match the Go version's pixels - decode one
// yourself (createImageBitmap in a browser, sharp in Node) and pass the
// RgbaImage instead.
export function decodeImage(data: Uint8Array): RgbaImage {
  if (data.length === 0) throw new SkinError('IMAGE', 'no image data')
  if (isJPEG(data)) throw new SkinError('IMAGE', 'not a valid image: JPEG is not supported; decode it and pass the pixels')
  return decodePNG(data)
}

// imageDimensions reads a PNG's width and height from its header without
// decoding the pixels, to refuse an oversized upload cheaply.
export function imageDimensions(data: Uint8Array): { width: number; height: number } {
  if (data.length === 0) throw new SkinError('IMAGE', 'no image data')
  if (!isPNG(data)) throw new SkinError('IMAGE', 'not a valid image: not a PNG')
  return pngDimensions(data)
}

// renderPNG renders and encodes the result as a PNG.
export function renderPNG(opts: RenderOptions): Uint8Array {
  return encodePNG(render(opts))
}

// renderGIF renders the animation as a looping animated GIF. GIF holds 256
// colours a frame, so the frames share a palette of the colours they use
// most (exact for most skins, which use fewer), and transparency is on or
// off per pixel, as the renderer's alpha test already makes it.
export function renderGIF(opts: AnimationOptions): Uint8Array {
  const [fps] = timing(opts)
  return encodeGIF(renderFrames(opts), fps)
}

// renderItemPNG renders an item on its own and encodes it as a PNG.
export function renderItemPNG(opts: ItemOptions): Uint8Array {
  return encodePNG(renderItem(opts))
}

// renderItemGIF renders the spinning item as a looping GIF.
export function renderItemGIF(opts: ItemAnimationOptions): Uint8Array {
  return encodeGIF(renderItemFrames(opts), !opts.fps ? 20 : opts.fps)
}

// ArmorBytes is Armor as encoded PNGs.
export interface ArmorBytes {
  helmet?: Uint8Array
  chestplate?: Uint8Array
  leggings?: Uint8Array
  boots?: Uint8Array
  elytra?: Uint8Array
}

// armorBytesSet is a full set from the game's two layer files: layer 1
// (helmet, chestplate, boots) and layer 2 (leggings).
export const armorBytesSet = (layer1: Uint8Array, layer2: Uint8Array): ArmorBytes => ({
  helmet: layer1,
  chestplate: layer1,
  leggings: layer2,
  boots: layer1,
})

// HeldBytes is Held with the item as an encoded PNG.
export interface HeldBytes {
  item?: Uint8Array
  flat?: boolean
  adjust?: ItemAdjust
}

// BytesOptions are RenderOptions with every image as an encoded PNG and
// the geometry as raw JSON - geometry.json as a client sends it, where
// empty, unset or the literal null draws the default model.
export interface BytesOptions extends Omit<RenderOptions, 'texture' | 'geometry' | 'cape' | 'animated' | 'armor' | 'rightHand' | 'leftHand'> {
  texture?: Uint8Array
  geometry?: Uint8Array | string
  cape?: Uint8Array
  animated?: { type: AnimatedType; data: Uint8Array }[]
  armor?: ArmorBytes
  rightHand?: HeldBytes
  leftHand?: HeldBytes
}

const has = (b: Uint8Array | undefined): b is Uint8Array => b !== undefined && b.length > 0

// named decodes one input, its errors saying which.
function named(what: string, data: Uint8Array): RgbaImage {
  try {
    return decodeImage(data)
  } catch (e) {
    if (e instanceof SkinError) throw new SkinError('IMAGE', `${what}: ${e.message.replace(/^bedrock-skin: /, '')}`, { cause: e })
    throw e
  }
}

// decodeOptions decodes BytesOptions into RenderOptions.
export function decodeOptions(opts: BytesOptions): RenderOptions {
  const { texture, geometry, cape, animated, armor, rightHand, leftHand, ...rest } = opts
  if (!has(texture) && !opts.hideSkin) throw new SkinError('NO_TEXTURE', 'texture is required')
  const out: RenderOptions = {
    ...rest,
    texture: has(texture) ? named('texture', texture) : newImage(0, 0),
    geometry: geometry === undefined || isEmpty(geometry) ? [] : parseGeometry(geometry),
    cape: has(cape) ? named('cape', cape) : undefined,
    animated: (animated ?? []).map((a) => ({ type: a.type, texture: named(`animation ${a.type}`, a.data) })),
  }
  // A set shares one file between several pieces, so each distinct file is
  // decoded once.
  const decoded = new Map<Uint8Array, RgbaImage>()
  const piece = (name: string, data: Uint8Array | undefined) => {
    if (!has(data)) return undefined
    for (const [seen, img] of decoded) if (sameBytes(seen, data)) return img
    const img = named(`armor ${name}`, data)
    decoded.set(data, img)
    return img
  }
  if (armor) {
    const a: Armor = {
      helmet: piece('helmet', armor.helmet),
      chestplate: piece('chestplate', armor.chestplate),
      leggings: piece('leggings', armor.leggings),
      boots: piece('boots', armor.boots),
      elytra: piece('elytra', armor.elytra),
    }
    out.armor = a
  }
  const held = (h: HeldBytes | undefined, name: string): Held | undefined =>
    h && { item: has(h.item) ? named(`${name} item`, h.item) : undefined, flat: h.flat, adjust: h.adjust }
  out.rightHand = held(rightHand, 'right hand')
  out.leftHand = held(leftHand, 'left hand')
  return out
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// renderBytes decodes the inputs, renders and encodes the result as a PNG.
export function renderBytes(opts: BytesOptions): Uint8Array {
  return renderPNG(decodeOptions(opts))
}

// AnimationBytesOptions are BytesOptions plus the animation and its timing.
export interface AnimationBytesOptions extends BytesOptions {
  animation: Animator
  fps?: number
  frames?: number
}

const animationOptions = (opts: AnimationBytesOptions): AnimationOptions => ({
  ...decodeOptions(opts),
  animation: opts.animation,
  fps: opts.fps,
  frames: opts.frames,
})

// renderGIFBytes decodes the inputs and renders the animation as a GIF.
export function renderGIFBytes(opts: AnimationBytesOptions): Uint8Array {
  return renderGIF(animationOptions(opts))
}

// renderFramesPNG decodes the inputs and renders the animation as one PNG a
// frame.
export function renderFramesPNG(opts: AnimationBytesOptions): Uint8Array[] {
  return prepareFrames(animationOptions(opts)).all().map(encodePNG)
}

// ItemBytesOptions are ItemOptions with the item as an encoded PNG.
export interface ItemBytesOptions extends Omit<ItemOptions, 'item'> {
  item: Uint8Array
}

function itemOptions<T extends ItemBytesOptions>(opts: T): Omit<T, 'item'> & { item: RgbaImage } {
  if (!has(opts.item)) throw new SkinError('NO_TEXTURE', 'texture is required')
  return { ...opts, item: named('item', opts.item) }
}

// renderItemBytes decodes the item, renders it on its own and encodes the
// result as a PNG.
export function renderItemBytes(opts: ItemBytesOptions): Uint8Array {
  return renderItemPNG(itemOptions(opts))
}

// ItemAnimationBytesOptions are ItemAnimationOptions with the item as an
// encoded PNG.
export interface ItemAnimationBytesOptions extends Omit<ItemAnimationOptions, 'item'> {
  item: Uint8Array
}

// renderItemGIFBytes decodes the item and renders it spinning as a GIF.
export function renderItemGIFBytes(opts: ItemAnimationBytesOptions): Uint8Array {
  return renderItemGIF(itemOptions(opts))
}
