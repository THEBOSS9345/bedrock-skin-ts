// bedrock-skin: Minecraft Bedrock skins rendered to images, a TypeScript port
// of bedrock-skin-go that draws the same pixels, in browsers and on servers.
//
//   import { decodeImage, renderPNG } from 'bedrock-skin'
//   const png = renderPNG({ texture: decodeImage(skinPng), view: 'avatar', size: 128 })
//
// Every function throws a SkinError, with a code, for bad input. See
// README.md for the whole API.

export { SkinError, type SkinErrorCode } from './errors'

// Rendering.
export {
  ANIMATED_BODY_128,
  ANIMATED_BODY_32,
  ANIMATED_FACE,
  DEFAULT_SIZE,
  render,
  renderItem,
  renderItemFrames,
  type AnimatedTexture,
  type AnimatedType,
  type ItemAnimationOptions,
  type ItemOptions,
  type RenderOptions,
} from './render'
export { render2D } from './render2d'
export { parseAngle, parseParts, parseView, type Angle, type Camera, type View } from './view'
export { armorSet, type Armor, type Held, type ItemAdjust, type Scale } from './equipment'

// Images.
export { newImage, textureFromRGBA, type RgbaImage } from './image'
export { encodePNG } from './png'
export {
  armorBytesSet,
  decodeImage,
  decodeOptions,
  imageDimensions,
  renderBytes,
  renderFramesPNG,
  renderGIF,
  renderGIFBytes,
  renderItemBytes,
  renderItemGIF,
  renderItemGIFBytes,
  renderItemPNG,
  renderPNG,
  type AnimationBytesOptions,
  type ArmorBytes,
  type BytesOptions,
  type HeldBytes,
  type ItemAnimationBytesOptions,
  type ItemBytesOptions,
} from './bytes'
export { encodeGIF } from './gif'

// Animation.
export { bonePose, Motion, MOTIONS, parseMotion, Pose, type Animator, type BonePose, type MotionName, type Vec3Tuple } from './pose'
export { Animation, exampleAnimations, parseAnimations } from './animfile'
export { Frames, prepareFrames, renderFrames, type AnimationOptions } from './frames'

// Geometry.
export {
  boneByName,
  boxUV,
  children,
  complexity,
  defaultGeometry,
  faceUVs,
  findCape,
  findLocator,
  isEmpty,
  parseGeometry,
  parseResourcePatch,
  selectGeometry,
  totalCubes,
  type Bone,
  type Cube,
  type FaceUV,
  type Geometry,
  type Locator,
  type ResourcePatch,
} from './geometry'
export { GeometryTree, GeometryValue, parseGeometryTree, type TreeValue } from './geoquery'
export { boneMesh, polygons, type PolyMesh, type PolyVertex } from './polymesh'
export { JsonObject, type JsonValue } from './json'

// Invisible-skin detection.
export { Skin, SkinReport, type PartReport, type PartVisibility, type SkinOptions, type Verdict } from './detect'
export {
  DEFAULT_MIN_GEOMETRY_SIZE,
  DEFAULT_MIN_VISIBLE_ALPHA,
  DEFAULT_MIN_VISIBLE_FRACTION,
  DEFAULT_MIN_VISIBLE_PARTS,
  isSkinInvisible,
  isSkinTiny,
  validateGeometrySize,
  validateSkinInvisibility,
  validateSkinVisibility,
  type GeometryInput,
  type GeometrySizeResult,
  type GeometryViolation,
  type SkinPartResult,
  type SkinVisibilityResult,
} from './invisible'

// Skins as the protocol sends them.
export { decodeWireSkin, skinOptions, wireSkinDetector, type DecodedSkin, type WireAnimation, type WireSkin } from './wire'
