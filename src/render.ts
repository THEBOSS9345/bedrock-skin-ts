// Rendering: options, framing, and the camera. See
// docs/views-and-cameras.md in bedrock-skin-go.

import {
  ARMOR_PIECES,
  ELYTRA_PIECE,
  armorGeometry,
  armorTextures,
  buildHeldItem,
  chestplateCapePose,
  elytraPose,
  handSkeleton,
  hands,
  heldToModel,
  holdingPose,
  itemTriangles,
  partsPose,
  type Armor,
  type Hand,
  type Held,
  type ItemAdjust,
  type Scale,
} from './equipment'
import { SkinError } from './errors'
import { boneByName, defaultGeometry, findCape, selectGeometry, type Bone, type Geometry } from './geometry'
import * as gomath from './gomath'
import { isEmptyImage, type RgbaImage } from './image'
import { boneWorldMatrices, buildTriangles } from './mesh'
import { hasMesh } from './polymesh'
import { Pose } from './pose'
import { Context, lookAt, perspective, vec3, type Triangle, type Vec3 } from './raster'
import { render2D } from './render2d'
import { sameBone } from './strings'
import type { Angle, Camera, View } from './view'

// DEFAULT_SIZE is the output edge length used when size is left out.
export const DEFAULT_SIZE = 512

// AnimatedType is the kind of a skin animation, numbered as the Bedrock
// protocol numbers them: 1 the face (eyes that blink), 2 a 32x32 animated
// body part, 3 a 128x128 one.
export type AnimatedType = 1 | 2 | 3

export const ANIMATED_FACE: AnimatedType = 1
export const ANIMATED_BODY_32: AnimatedType = 2
export const ANIMATED_BODY_128: AnimatedType = 3

// AnimatedTexture is one skin animation's image: its frames stacked top to
// bottom, as the client sends it.
export interface AnimatedTexture {
  type: AnimatedType
  texture: RgbaImage
}

const ENTRY_PREFIX: Record<AnimatedType, string> = {
  1: 'geometry.animated_face',
  2: 'geometry.animated_32x32',
  3: 'geometry.animated_128x128',
}

// animatedEntry is the entry an animation type draws.
export const animatedEntry = (geos: Geometry[], type: AnimatedType): Geometry | undefined =>
  geos.find((g) => g.identifier.startsWith(ENTRY_PREFIX[type]))

// RenderOptions describes one render. Only texture is required: the rest
// default to a full-body, straight-on, 512x512 render on the default model.
export interface RenderOptions {
  // The skin texture. Bedrock skins are normally 64x64 or 128x128, but any
  // size works. Not needed with hideSkin.
  texture?: RgbaImage
  // The skin's model, from parseGeometry. Empty or left out uses
  // defaultGeometry(), which is what a Bedrock client draws for a skin that
  // uses a built-in model - most skins.
  geometry?: Geometry[]
  // Which entry of the geometry to render, as the skin's resource patch
  // names it, e.g. geometry.humanoid.customSlim. Empty, or naming an entry
  // that is not there, uses the entry with the most cubes. The resource
  // patch is the authoritative wide-vs-slim selector, not the login
  // packet's ArmSize.
  identifier?: string
  // An equipped cape texture. Its mesh comes from a cape bone in the
  // geometry, else the built-in geometry.cape. Not drawn for the head and
  // avatar views.
  cape?: RgbaImage
  // The framing; body when left out. Ignored when parts is set.
  view?: View
  // The camera preset; left out, the view's default (iso for head, front
  // otherwise). Ignored when camera is set.
  angle?: Angle
  // Exactly which bones to render, e.g. ['head', 'leftArm']. Each pulls in
  // everything parented under it. Empty means use view.
  parts?: string[]
  // An explicit camera, overriding the view's framing and the angle.
  camera?: Camera
  // The output edge length in pixels; the image is square. 0 or unset
  // means DEFAULT_SIZE.
  size?: number
  // Moves bones from where the geometry puts them, e.g. a frame of a
  // Motion. Left out is the rest pose.
  pose?: Pose
  // The extra textures a persona skin's animations carry - the face, and
  // animated body parts. Each draws the geometry entry made for it
  // alongside the main one; a persona skin's head lives only in its face
  // entry.
  animated?: AnimatedTexture[]
  // The armor and elytra worn over the skin.
  armor?: Armor
  // The items held in each hand.
  rightHand?: Held
  leftHand?: Held
  // Resizes the figure or any bone.
  scale?: Scale
  // Draws the equipment alone - armor, elytra, held items and cape - posed
  // and framed as it would be on the skin, so any piece can be rendered by
  // itself; parts and view pick which. The texture is then not read. An
  // EMPTY_VIEW or NO_MATCHING_PARTS error means no equipment was left to
  // draw.
  hideSkin?: boolean
}

// Layer is triangles drawn with one texture. A scene draws its layers in
// order: the body, any animated persona parts, the armor, held items, then
// the cape.
export interface Layer {
  triangles: Triangle[]
  texture: RgbaImage
}

// Scene is everything a render works out before placing the camera. flat is
// set instead for geometry with nothing to rasterize.
export interface Scene {
  layers: Layer[]
  fov: number
  margin: number
  yaw: number
  pitch: number
  size: number
  flat?: RgbaImage
}

const NO_POSE = new Pose()

// scene works out everything a render needs but the camera.
export function scene(opts: RenderOptions, pose: Pose): Scene {
  const hideSkin = opts.hideSkin ?? false
  const texture = opts.texture
  if (!hideSkin && isEmptyImage(texture)) throw new SkinError('NO_TEXTURE', 'texture is required')
  const size = !opts.size ? DEFAULT_SIZE : opts.size
  const geos = !opts.geometry || opts.geometry.length === 0 ? defaultGeometry() : opts.geometry
  const geo = selectGeometry(geos, opts.identifier ?? '')
  if (!geo) throw new SkinError('NO_GEOMETRY', 'geometry has no usable entries')
  const view = opts.view ?? 'body'
  const parts = opts.parts ?? []

  // Part scales and holding an item change the pose of the skin, its armor
  // and the item alike.
  pose = partsPose(opts.scale, pose)
  const held: { skel: Geometry; side: Hand; h: Held; item: RgbaImage }[] = []
  const sides = hands()
  const holding = [opts.rightHand, opts.leftHand]
  for (let i = 0; i < 2; i++) {
    const h = holding[i]
    if (!h?.item) continue
    const sk = handSkeleton(sides[i]!, geo)
    if (sk) {
      pose = holdingPose(sides[i]!, pose, sk.arm)
      held.push({ skel: sk.skel, side: sides[i]!, h, item: h.item })
    }
  }

  // No cubes and no poly mesh anywhere: bones with nothing to draw. A flat
  // crop is the only output left.
  if (!hasMesh(geo) && !hideSkin) {
    return { layers: [], fov: 0, margin: 0, yaw: 0, pitch: 0, size, flat: render2D(texture!, view, size) }
  }

  let fov = 35.0
  let margin = 1.5
  const includeFor = (g: Geometry): ((name: string) => boolean) | undefined => {
    if (parts.length > 0) {
      const byName = boneMap(g)
      return (name) => parts.some((p) => isDescendant(byName, name, p))
    }
    return includeForView(g, view)
  }
  const buildPosed = (g: Geometry, p: Pose) => buildTriangles(g, includeFor(g), p)
  const build = (g: Geometry) => buildPosed(g, pose)
  const includes = (g: Geometry, name: string) => {
    const inc = includeFor(g)
    return inc ? inc(name) : true
  }
  const empty = () =>
    parts.length === 0
      ? new SkinError('EMPTY_VIEW', 'nothing to render for this view')
      : new SkinError('NO_MATCHING_PARTS', 'no bones matched the requested parts')

  const layers: Layer[] = []
  if (!hideSkin) {
    const triangles = build(geo)
    let drawn = triangles.length
    layers.push({ triangles, texture: texture! })
    for (const a of opts.animated ?? []) {
      const g = animatedEntry(geos, a.type)
      if (g && g.identifier !== geo.identifier) {
        const t = build(g)
        drawn += t.length
        layers.push({ triangles: t, texture: a.texture })
      }
    }
    // With the skin drawn, equipment never decides whether the view has
    // anything in it: that is the skin's to answer.
    if (drawn === 0) throw empty()
  }
  const pieces = armorTextures(opts.armor ?? {})
  for (let i = 0; i < pieces.length; i++) {
    const tex = pieces[i]
    if (!tex) continue
    const g = armorGeometry(ARMOR_PIECES[i]!)
    layers.push({ triangles: i === ELYTRA_PIECE ? buildPosed(g, elytraPose(pose)) : build(g), texture: tex })
  }
  for (const { skel, side, h, item } of held) {
    if (includes(skel, side.bone)) {
      const world = boneWorldMatrices(skel, pose).get(side.bone)!
      layers.push({ triangles: buildHeldItem(item, heldToModel(h, side), world), texture: item })
    }
  }
  if (parts.length === 0) [fov, margin] = framingFor(view)

  let yaw: number
  let pitch: number
  if (opts.camera) {
    const cam = opts.camera
    yaw = cam.yaw ?? 0
    pitch = cam.pitch ?? 0
    if ((cam.fov ?? 0) > 0) fov = cam.fov!
    if ((cam.margin ?? 0) > 0) margin = cam.margin!
  } else {
    const angle = opts.angle ?? (view === 'head' ? 'iso' : 'front')
    if (angle === 'iso') {
      // Offset diagonally rather than pulled straight back, the iso camera
      // needs extra margin not to clip a corner.
      margin *= 1.25
      yaw = ISO_YAW
      pitch = ISO_PITCH
    } else {
      yaw = 0
      pitch = 0
    }
  }
  const model = opts.scale?.model ?? 0
  // The camera fits the model's bounds; less room around them draws it
  // larger.
  if (model > 0) margin /= model

  // The cape is built before the camera: it hangs behind and below the body,
  // so framing on the body alone can push it out of shot.
  if (opts.cape && capeVisibleIn(view, parts)) {
    const capeGeo = capeGeometryFor(geos, geo)
    if (capeGeo) {
      const capePose = armorTextures(opts.armor ?? {})[1] ? chestplateCapePose(pose) : pose
      const triangles = buildTriangles(capeGeo, (name) => name === 'cape', capePose)
      if (triangles.length > 0) layers.push({ triangles, texture: opts.cape })
    }
  }
  if (hideSkin && layers.every((l) => l.triangles.length === 0)) throw empty()
  return { layers, fov, margin, yaw, pitch, size }
}

// render draws a skin into a square image.
//
// With only a texture set, this is the full body of a standard humanoid,
// straight on, at 512x512. Persona skins render in 3D from their poly
// meshes; add their animation images with animated to get the head.
// Geometry whose bones draw nothing falls back to a flat crop (render2D).
export function render(opts: RenderOptions): RgbaImage {
  const sc = scene(opts, opts.pose ?? NO_POSE)
  if (sc.flat) return sc.flat
  const [eye, center] = cameraForTriangles(framing(sc), sc.fov, sc.margin, sc.yaw, sc.pitch)
  return rasterize(sc.layers, eye, center, sc.fov, sc.size)
}

// framing is what the camera is fitted around: every layer.
export const framing = (sc: Scene): Triangle[] => sc.layers.flatMap((l) => l.triangles)

function boneMap(geo: Geometry): Map<string, Bone> {
  const m = new Map<string, Bone>()
  for (const b of geo.bones) m.set(b.name, b)
  return m
}

function isDescendant(byName: Map<string, Bone>, name: string, ancestor: string): boolean {
  const seen: string[] = []
  let cur = name
  while (cur !== '' && !seen.includes(cur)) {
    if (sameBone(cur, ancestor)) return true
    seen.push(cur)
    cur = byName.get(cur)?.parent ?? ''
  }
  return false
}

function includeForView(geo: Geometry, view: View): ((name: string) => boolean) | undefined {
  const byName = boneMap(geo)
  switch (view) {
    case 'head':
    case 'avatar':
      return (name) => isDescendant(byName, name, 'head')
    // A bust: head, torso and both arms with their own descendants.
    case 'chest':
      return (name) =>
        isDescendant(byName, name, 'head') ||
        isDescendant(byName, name, 'leftArm') ||
        isDescendant(byName, name, 'rightArm') ||
        sameBone(name, 'body') ||
        sameBone(name, 'waist')
    case 'body':
      return undefined
  }
}

// capeVisibleIn reports whether a framing shows the cape: a head or avatar
// crop does not, and a parts list only when it names cape.
function capeVisibleIn(view: View, parts: string[]): boolean {
  if (parts.length > 0) return parts.includes('cape')
  return view !== 'head' && view !== 'avatar'
}

// capeGeometryFor is the entry to draw an equipped cape from: never the body
// entry being rendered (a body with its own cape bone would draw it twice,
// z-fighting), falling back to the built-in geometry.cape - which is what
// makes capes work at all on custom-mesh skins, whose geometry has no cape
// bone.
function capeGeometryFor(geos: Geometry[], body: Geometry): Geometry | undefined {
  return (
    geos.find((g) => g.identifier !== body.identifier && (boneByName(g, 'cape')?.cubes.length ?? 0) > 0) ??
    findCape(defaultGeometry())
  )
}

// framingFor is the field of view and margin that suit a view: avatar is a
// tight crop, head leaves more headroom, chest and body fit a much taller
// subject.
function framingFor(view: View): [number, number] {
  switch (view) {
    case 'avatar':
      return [25.0, 1.15]
    case 'head':
      return [30.0, 1.4]
    case 'chest':
      return [35.0, 1.5]
    case 'body':
      return [35.0, 1.6]
  }
}

// The iso preset shows three faces at once (front, top, one side) without
// foreshortening any of them away to nothing.
export const ISO_YAW = 35.0
export const ISO_PITCH = 25.0

export function boundingBox(triangles: Triangle[]): [Vec3, Vec3] {
  let lo: Vec3 | undefined
  let hi: Vec3 | undefined
  for (const t of triangles) {
    for (const v of t) {
      const p = v.position
      if (!lo || !hi) {
        lo = p
        hi = p
        continue
      }
      lo = vec3(gomath.min(lo.x, p.x), gomath.min(lo.y, p.y), gomath.min(lo.z, p.z))
      hi = vec3(gomath.max(hi.x, p.x), gomath.max(hi.y, p.y), gomath.max(hi.z, p.z))
    }
  }
  const zero = vec3(0, 0, 0)
  return [lo ?? zero, hi ?? zero]
}

// cameraForTriangles frames the camera from the triangles' actual bounding
// box, never a fixed distance. yaw 0, pitch 0 sits the camera on the -Z
// side looking toward +Z, up +Y.
export function cameraForTriangles(triangles: Triangle[], fov: number, margin: number, yaw: number, pitch: number): [Vec3, Vec3] {
  const [lo, hi] = boundingBox(triangles)
  return cameraForBounds(lo, hi, fov, margin, yaw, pitch)
}

// cameraForBounds is cameraForTriangles with the bounding box already
// worked out, so a caller holding one - Frames, across many draws - can
// refit the camera without walking the triangles again.
export function cameraForBounds(lo: Vec3, hi: Vec3, fov: number, margin: number, yaw: number, pitch: number): [Vec3, Vec3] {
  const center = vec3((lo.x + hi.x) / 2.0, (lo.y + hi.y) / 2.0, (lo.z + hi.z) / 2.0)
  let half = gomath.max((hi.x - lo.x) / 2.0, gomath.max((hi.y - lo.y) / 2.0, (hi.z - lo.z) / 2.0))
  if (half <= 0) half = 1.0
  const halfFov = (fov * Math.PI) / 360.0
  const distance = (half / gomath.tan(halfFov)) * margin
  const y = (yaw * Math.PI) / 180.0
  const p = (pitch * Math.PI) / 180.0
  const offset = vec3(-distance * gomath.sin(y) * gomath.cos(p), distance * gomath.sin(p), -distance * gomath.cos(y) * gomath.cos(p))
  return [vec3(center.x + offset.x, center.y + offset.y, center.z + offset.z), center]
}

// rasterize draws each layer with its own texture, in order.
export function rasterize(layers: Layer[], eye: Vec3, center: Vec3, fov: number, size: number): RgbaImage {
  const ctx = new Context(size, size)
  // Clip space only - the screen mapping comes after the perspective divide.
  const matrix = perspective(lookAt(eye, center, vec3(0, 1, 0)), fov, 1.0, 1.0, 500.0)
  for (const l of layers) {
    if (l.triangles.length === 0) continue
    for (const t of l.triangles) ctx.drawTriangle(t, matrix, l.texture)
  }
  return ctx.image()
}

// ItemOptions renders one item on its own, extruded as a held item is.
// Only item is required.
export interface ItemOptions {
  // The item's sprite, e.g. textures/items/diamond_sword.png.
  item: RgbaImage
  // The camera preset: front faces the sprite, as an inventory icon; iso
  // turns it to show its depth. Left out means front. Ignored when camera
  // is set.
  angle?: Angle
  // An explicit camera, overriding the angle.
  camera?: Camera
  // The output edge length; the image is square. 0 or unset means
  // DEFAULT_SIZE.
  size?: number
  // Turns and resizes the item about its centre. The camera frames the item
  // whatever its size or offset, so only the rotation changes the picture.
  adjust?: ItemAdjust
}

function itemFraming(o: ItemOptions): [number, number, number, number] {
  let fov = 35.0
  let margin = 1.2
  if (o.camera) {
    const cam = o.camera
    if ((cam.fov ?? 0) > 0) fov = cam.fov!
    if ((cam.margin ?? 0) > 0) margin = cam.margin!
    return [fov, margin, cam.yaw ?? 0, cam.pitch ?? 0]
  }
  if (o.angle === 'iso') return [fov, margin * 1.25, ISO_YAW, ISO_PITCH]
  return [fov, margin, 0, 0]
}

function checkItem(o: ItemOptions): void {
  if (isEmptyImage(o.item)) throw new SkinError('EMPTY_VIEW', 'nothing to render for this view')
}

// renderItem draws an item on its own: the sprite extruded one texel deep,
// as the game draws a held item, centred and framed by the camera.
export function renderItem(o: ItemOptions): RgbaImage {
  checkItem(o)
  const triangles = itemTriangles(o.item, o.adjust, 0)
  const [fov, margin, yaw, pitch] = itemFraming(o)
  const [eye, center] = cameraForTriangles(triangles, fov, margin, yaw, pitch)
  return rasterize([{ triangles, texture: o.item }], eye, center, fov, !o.size ? DEFAULT_SIZE : o.size)
}

// ItemAnimationOptions spins an item on its own: one full turn about its
// upright axis each loop, as a dropped item turns.
export interface ItemAnimationOptions extends ItemOptions {
  // How long one turn takes, in seconds. 0 or unset means 3.
  duration?: number
  // Frames per second; 0 or unset means 20.
  fps?: number
  // How many frames to render; 0 or unset means one turn.
  frames?: number
}

// renderItemFrames draws the spinning item frame by frame. Every frame
// shares one camera, fitted around the whole turn, so the item turns in a
// still frame.
export function renderItemFrames(o: ItemAnimationOptions): RgbaImage[] {
  checkItem(o)
  const duration = !o.duration || o.duration <= 0 ? 3.0 : o.duration
  const fps = !o.fps ? 20 : o.fps
  const frames = !o.frames ? Math.max(gomath.round(duration * fps), 1) : o.frames
  const turns: Triangle[][] = []
  const sweep: Triangle[] = []
  for (let i = 0; i < frames; i++) {
    const spin = (360.0 * (i / fps)) / duration
    const tris = itemTriangles(o.item, o.adjust, spin)
    for (const t of tris) sweep.push(t)
    turns.push(tris)
  }
  const [fov, margin, yaw, pitch] = itemFraming(o)
  const [eye, center] = cameraForTriangles(sweep, fov, margin, yaw, pitch)
  const size = !o.size ? DEFAULT_SIZE : o.size
  return turns.map((triangles) => rasterize([{ triangles, texture: o.item }], eye, center, fov, size))
}
