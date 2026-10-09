// bedrock-skin: Minecraft Bedrock skins rendered to images, a TypeScript port
// of bedrock-skin-go that draws the same pixels.
//
// The port is under way: it grows a stage at a time, each checked against
// what the Go library draws (testdata/parity).

export { SkinError, type SkinErrorCode } from './errors'
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
export { JsonObject, type JsonValue } from './json'
