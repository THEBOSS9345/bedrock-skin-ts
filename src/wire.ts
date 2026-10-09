// A skin as a Bedrock client sends it, turned into render options.

import { Skin } from './detect'
import { SkinError } from './errors'
import { isEmpty, parseGeometry, parseResourcePatch, type Geometry } from './geometry'
import { textureFromRGBA, type RgbaImage } from './image'
import type { AnimatedTexture, AnimatedType, RenderOptions } from './render'

// WireSkin is a skin as a Bedrock client sends it - in the login packet, a
// PlayerList entry or a PlayerSkin packet: images as raw RGBA with their
// sizes alongside, and the model as JSON. The field names follow the
// protocol's, so a proxy or bot can fill one straight from the packet:
//
//   const skin = decodeWireSkin({
//     skinData: pixels, skinWidth: 64, skinHeight: 64,
//     geometry: 'null',
//     resourcePatch: '{"geometry":{"default":"geometry.humanoid.customSlim"}}',
//   })
//   const png = renderPNG({ ...skinOptions(skin), view: 'avatar', size: 128 })
//
// See docs/skin-data.md in bedrock-skin-go for what each field holds.
export interface WireSkin {
  // The skin's pixels, raw non-premultiplied RGBA, width*height*4 bytes.
  skinData: Uint8Array
  skinWidth: number
  skinHeight: number
  // The cape's pixels in the same form; empty or unset for no cape.
  capeData?: Uint8Array
  capeWidth?: number
  capeHeight?: number
  // SkinGeometryData. Empty, unset or the literal null - what a client
  // sends for a built-in model - draws the default model.
  geometry?: Uint8Array | string
  // SkinResourcePatch: it names which entry of the geometry the skin uses,
  // wide or slim among them.
  resourcePatch?: Uint8Array | string
  // The skin's animation list. A persona skin's face, and some of its body,
  // are textured by these.
  animations?: WireAnimation[]
}

// WireAnimation is one entry of a skin's animation list: its image as raw
// RGBA, and its type as the protocol numbers it.
export interface WireAnimation {
  animationType: number
  data: Uint8Array
  width: number
  height: number
}

// DecodedSkin is a WireSkin decoded: the images it carried, its geometry,
// and the entry its resource patch names. skinOptions renders it.
export interface DecodedSkin {
  texture: RgbaImage
  cape?: RgbaImage
  // Empty for a built-in model, which renders the default model.
  geometry: Geometry[]
  // The entry the resource patch names; empty when it names none.
  identifier: string
  // The animation images the renderer draws, by type.
  animated: AnimatedTexture[]
}

const image = (what: string, data: Uint8Array, w: number, h: number): RgbaImage => {
  try {
    return textureFromRGBA(data, w, h)
  } catch (e) {
    if (e instanceof SkinError) throw new SkinError('PIXELS', `${what}: ${e.message.replace(/^bedrock-skin: /, '')}`, { cause: e })
    throw e
  }
}

const isAnimatedType = (n: number): n is AnimatedType => n === 1 || n === 2 || n === 3

// decodeWireSkin decodes the wire fields: the images wrapped, the geometry
// parsed, the entry the resource patch names picked out, and the animation
// images kept so persona heads draw.
//
// A resource patch that does not parse is not an error - the patch only
// picks an entry, and without it the entry with the most cubes is used, as
// for an empty patch. Malformed geometry and images whose data does not
// match their size are errors. An animation of a type the renderer does not
// draw is skipped.
export function decodeWireSkin(w: WireSkin): DecodedSkin {
  const texture = image('skin', w.skinData, w.skinWidth, w.skinHeight)
  const cape = w.capeData && w.capeData.length > 0 ? image('cape', w.capeData, w.capeWidth ?? 0, w.capeHeight ?? 0) : undefined
  const geometry = w.geometry === undefined || isEmpty(w.geometry) ? [] : parseGeometry(w.geometry)
  let identifier = ''
  if (w.resourcePatch !== undefined && w.resourcePatch.length > 0) {
    try {
      identifier = parseResourcePatch(w.resourcePatch).default
    } catch (e) {
      if (!(e instanceof SkinError)) throw e
    }
  }
  const animated: AnimatedTexture[] = []
  for (const a of w.animations ?? []) {
    const img = image(`animation ${a.animationType}`, a.data, a.width, a.height)
    if (isAnimatedType(a.animationType)) animated.push({ type: a.animationType, texture: img })
  }
  return { texture, cape, geometry, identifier, animated }
}

// wireSkinDetector is the invisibility detector's view of the same fields:
// the texture and its geometry. It does not need the cape or the
// animations.
export function wireSkinDetector(w: WireSkin): Skin {
  const texture = image('skin', w.skinData, w.skinWidth, w.skinHeight)
  const geometry = w.geometry === undefined || isEmpty(w.geometry) ? undefined : w.geometry
  return new Skin(texture, geometry)
}

// skinOptions are render options for a decoded skin, its cape, model and
// animation images set; spread them and set the view, size and the rest.
export function skinOptions(d: DecodedSkin): RenderOptions {
  return { texture: d.texture, geometry: d.geometry, identifier: d.identifier, cape: d.cape, animated: d.animated }
}
