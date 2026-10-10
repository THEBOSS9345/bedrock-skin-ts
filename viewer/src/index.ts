// bedrock-skin-viewer: a drop-in 3D viewer for Minecraft Bedrock skins, drawn
// by bedrock-skin. Three ways in:
//
//   - SkinViewer (this module): in any element, from any code
//   - <bedrock-skin-viewer> ('bedrock-skin-viewer/element'): HTML, and any
//     framework
//   - <SkinViewer> ('bedrock-skin-viewer/react'): React

export { SkinViewer, type SkinViewerEvents, type ViewerState } from './viewer'
export { EngineError as SkinViewerError, type WorkerOption } from './backend'
export type { AnimationInfo } from './protocol'
export type {
  AnimationInput,
  ArmorInput,
  Background,
  BoneMove,
  Camera,
  CustomAnimation,
  Controls,
  HeldInput,
  ImageInput,
  ItemAdjust,
  JSONInput,
  NameTag,
  RgbaImage,
  Scale,
  Skin,
  SkinInput,
  SkinViewerOptions,
  View,
} from './types'
