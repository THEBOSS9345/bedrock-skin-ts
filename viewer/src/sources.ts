// Turning what a person passes in into what the engine takes: URLs made
// absolute (a worker would read them against its own address), page-only
// things such as an <img> made into bitmaps, parsed JSON written out. And
// keys, so setting the same skin twice does nothing.

import type { WireAnimation, WireHeld, WireImage, WireJSON, WireSkin } from './protocol'
import type { AnimationInput, HeldInput, ImageInput, JSONInput, Skin, SkinInput } from './types'

const baseURL = () => (typeof document !== 'undefined' ? document.baseURI : typeof location !== 'undefined' ? location.href : undefined)

const absolute = (u: string | URL) => {
  const base = baseURL()
  return base ? new URL(u, base).href : String(u)
}

const isImageData = (v: unknown): v is ImageData => typeof ImageData !== 'undefined' && v instanceof ImageData
const isElement = (v: unknown, name: 'HTMLImageElement' | 'HTMLCanvasElement' | 'OffscreenCanvas') =>
  typeof (globalThis as Record<string, unknown>)[name] === 'function' && v instanceof ((globalThis as Record<string, unknown>)[name] as new () => object)

const BITMAP_OPTIONS: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }

export async function wireImage(src: ImageInput): Promise<WireImage> {
  if (typeof src === 'string' || src instanceof URL) return absolute(src)
  if (isElement(src, 'HTMLImageElement')) {
    const img = src as HTMLImageElement
    await img.decode()
    // Its own URL, read exactly, where it has one; otherwise its pixels.
    if (img.currentSrc) return absolute(img.currentSrc)
    return createImageBitmap(img, BITMAP_OPTIONS)
  }
  if (isElement(src, 'HTMLCanvasElement') || isElement(src, 'OffscreenCanvas')) {
    return createImageBitmap(src as HTMLCanvasElement, BITMAP_OPTIONS)
  }
  if (isImageData(src)) return { width: src.width, height: src.height, data: src.data }
  return src as WireImage
}

const isBinary = (v: unknown) =>
  v instanceof ArrayBuffer || ArrayBuffer.isView(v) || (typeof Blob !== 'undefined' && v instanceof Blob)

export function wireJSON(src: JSONInput): WireJSON {
  if (src instanceof URL) return { url: src.href }
  if (typeof src === 'string') {
    const t = src.trimStart()
    return t.startsWith('{') || t.startsWith('[') || t === 'null' ? { text: src } : { url: absolute(src) }
  }
  if (isBinary(src)) return { bytes: src as Blob }
  return { text: JSON.stringify(src) }
}

// isSkin tells a Skin from an image given on its own.
export function isSkin(s: SkinInput): s is Skin {
  if (typeof s !== 'object' || s === null || s instanceof URL || isBinary(s)) return false
  if (isImageData(s) || isElement(s, 'HTMLImageElement') || isElement(s, 'HTMLCanvasElement') || isElement(s, 'OffscreenCanvas')) return false
  if (typeof ImageBitmap !== 'undefined' && s instanceof ImageBitmap) return false
  // Raw pixels have a width; a Skin never does.
  return !('width' in s)
}

const held = async (h: HeldInput | undefined): Promise<WireHeld | undefined> => {
  if (h === undefined || h === null) return undefined
  if (typeof h === 'object' && 'item' in h && !('width' in h)) return { item: await wireImage(h.item), flat: h.flat, adjust: h.adjust }
  return { item: await wireImage(h as ImageInput) }
}

export async function wireSkin(input: SkinInput): Promise<WireSkin> {
  const s: Skin = isSkin(input) ? input : { texture: input }
  const img = (v: ImageInput | undefined) => (v === undefined || v === null ? undefined : wireImage(v))
  const a = s.armor ?? {}
  const [texture, cape, face, helmet, chestplate, leggings, boots, elytra, rightHand, leftHand, animated] = await Promise.all([
    img(s.texture),
    img(s.cape),
    img(s.face),
    img(a.helmet ?? a.layer1),
    img(a.chestplate ?? a.layer1),
    img(a.leggings ?? a.layer2),
    img(a.boots ?? a.layer1),
    img(a.elytra),
    held(s.rightHand),
    held(s.leftHand),
    Promise.all((s.animated ?? []).map(async (x) => ({ type: x.type, texture: await wireImage(x.texture) }))),
  ])
  if (face && !animated.some((x) => x.type === 1)) animated.push({ type: 1, texture: face })
  return {
    texture,
    geometry: s.geometry === undefined || s.geometry === null ? undefined : wireJSON(s.geometry),
    model: s.model,
    resourcePatch: s.resourcePatch === undefined || s.resourcePatch === null ? undefined : wireJSON(s.resourcePatch),
    cape,
    animated,
    armor: { helmet, chestplate, leggings, boots, elytra },
    rightHand,
    leftHand,
    scale: s.scale,
    hideSkin: s.hideSkin,
  }
}

export function wireAnimation(a: AnimationInput | undefined): WireAnimation {
  if (a === undefined || a === null) return ''
  if (typeof a === 'string') return a
  return { file: wireJSON(a.file), name: a.name }
}

// ---- keys ----

// Objects that are data a key cannot read (a Blob, an image) are named by
// identity: the same object is the same input.
const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => {
  let id = ids.get(o)
  if (id === undefined) ids.set(o, (id = ++nextId))
  return id
}

// keyOf is a string naming an input: equal inputs, equal keys.
export function keyOf(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (x instanceof URL) return absolute(x)
    if (typeof x === 'string') return x
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return x
    const proto = Object.getPrototypeOf(x)
    if (proto === Object.prototype || proto === null) {
      // Raw pixels are data: by identity, as reading them all would be slow.
      if ('width' in x && 'data' in x) return `#${idOf(x)}`
      // Its keys in order: the same skin written another way round is the
      // same skin.
      const o = x as Record<string, unknown>
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
    }
    return `#${idOf(x)}`
  })
}

export const skinKey = (s: SkinInput | null | undefined) => (s === null || s === undefined ? '' : keyOf(isSkin(s) ? s : { texture: s }))
