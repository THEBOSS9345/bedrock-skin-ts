// Armor, the elytra, held items, scale, and items on their own. See
// docs/equipment.md in bedrock-skin-go.

import armorGeometryJSON from './generated/armor_geometry'
import { newBone, parseGeometry, type Bone, type Geometry } from './geometry'
import * as gomath from './gomath'
import type { RgbaImage } from './image'
import { at, rotationMatrix } from './mesh'
import { bonePose, type BonePose, type Pose } from './pose'
import { IDENTITY, mul as mul2, mulPosition, vec3, vertex, type Mat4, type Triangle, type Vertex } from './raster'
import { sameBone } from './strings'

// Armor is the armor a skin wears: one texture per piece, as a resource
// pack lays them out. The helmet, chestplate and boots take the set's first
// layer (e.g. textures/models/armor/diamond_1.png), the leggings its second
// (diamond_2.png). A piece left out is not worn, so pieces from different
// sets mix freely.
export interface Armor {
  helmet?: RgbaImage
  chestplate?: RgbaImage
  leggings?: RgbaImage
  boots?: RgbaImage
  // The elytra's texture (textures/models/armor/elytra.png), worn on the
  // back. It takes the chestplate's slot, as in game: with both set, only
  // the elytra is worn.
  elytra?: RgbaImage
}

// armorSet is a full set of one material: layer1 for the helmet, chestplate
// and boots, layer2 for the leggings.
export const armorSet = (layer1: RgbaImage, layer2: RgbaImage): Armor => ({
  helmet: layer1,
  chestplate: layer1,
  leggings: layer2,
  boots: layer1,
})

// armorTextures are each piece's texture in ARMOR_PIECES order.
export function armorTextures(a: Armor): (RgbaImage | undefined)[] {
  return [a.helmet, a.elytra ? undefined : a.chestplate, a.leggings, a.boots, a.elytra]
}

// ARMOR_PIECES are each piece's model, in the order armorTextures lists
// them, which is also the order they are drawn.
export const ARMOR_PIECES = [
  'geometry.humanoid.armor.helmet',
  'geometry.humanoid.armor.chestplate',
  'geometry.humanoid.armor.leggings',
  'geometry.humanoid.armor.boots',
  'geometry.elytra',
] as const

// ELYTRA_PIECE is the elytra's index in ARMOR_PIECES.
export const ELYTRA_PIECE = 4

let armorGeos: Geometry[] | undefined

// armorGeometry is the vanilla armor model's entry for one piece: the sizes
// and inflates of the game's geometry.humanoid.armor1 and armor2, and its
// geometry.elytra, on the player model's skeleton so a pose moves it with
// the skin.
export function armorGeometry(identifier: string): Geometry {
  armorGeos ??= parseGeometry(armorGeometryJSON)
  const g = armorGeos.find((g) => g.identifier === identifier)
  if (!g) throw new Error(`bedrock-skin: the bundled armor geometry has no ${identifier}`)
  return g
}

// elytraPose is pose with the elytra's own resting pose on top, vanilla's
// animation.elytra.default: the body bone scaled up, the wings spread out
// and back.
export function elytraPose(pose: Pose): Pose {
  return pose.with([
    ['body', bonePose({ scale: [1.067, 1.067, 1.067] })],
    ['left_wing', bonePose({ position: [4.5, 4.0, -2.0], rotation: [15.0, 0, -13.0], scale: [1.0, 1.0, 2.0] })],
    ['right_wing', bonePose({ position: [-4.5, 4.0, -2.0], rotation: [15.0, 0, 13.0], scale: [1.0, 1.0, 2.0] })],
  ])
}

// CHESTPLATE_CAPE_OFFSET is how far back a cape hangs over a chestplate, in
// model units. The chestplate's body is the body grown by 1.01 on every
// side, so a cape left where it rests on the back is drawn inside it. Java
// Edition moves the cape back by the same amount when a chestplate is worn.
const CHESTPLATE_CAPE_OFFSET = 1.1

// chestplateCapePose is pose with the cape moved back clear of a chestplate.
export function chestplateCapePose(pose: Pose): Pose {
  return pose.with([['cape', bonePose({ position: [0, 0, CHESTPLATE_CAPE_OFFSET] })]])
}

// Scale resizes the figure or any of its bones. Left out, it changes
// nothing. A held item has its own scale, in ItemAdjust.
export interface Scale {
  // The figure's size in the image: 2 draws it twice as large, cropping
  // what no longer fits; 0.5 half as large. 0 or unset means 1. The camera
  // frames the model whatever its size, so only this changes how big it
  // looks.
  model?: number
  // Scales bones by name, ignoring case, each about its own pivot and
  // carrying everything parented under it: the armor on it, and an arm's
  // held item. 0 hides a bone.
  parts?: Record<string, number> | Map<string, number>
}

// partsPose is pose with the scale's parts applied.
export function partsPose(s: Scale | undefined, pose: Pose): Pose {
  const parts = s?.parts instanceof Map ? [...s.parts] : Object.entries(s?.parts ?? {})
  if (parts.length === 0) return pose
  return pose.with(parts.map(([name, k]) => [name, bonePose({ scale: [k, k, k] })] as const))
}

// ItemAdjust moves a held item from the game's placement, about its grip and
// in the hand's frame, so it follows the arm. Left out, it moves nothing.
export interface ItemAdjust {
  // Moves the item, in model units along the model's axes, as a bone's
  // position moves a bone.
  offset?: [number, number, number]
  // Turns the item about its grip, in degrees, as a bone's rotation turns a
  // bone: a positive X tips its top forward.
  rotation?: [number, number, number]
  // Resizes the item about its grip. 0 or unset means 1.
  scale?: number
}

// adjustMatrix is the adjustment as a transform about the origin: scale,
// then rotation, then offset.
function adjustMatrix(a: ItemAdjust | undefined): Mat4 {
  const k = !a?.scale ? 1.0 : a.scale
  const o = a?.offset ?? [0, 0, 0]
  return mul2(mul2(translate(o[0], o[1], o[2]), rotationMatrix(a?.rotation ?? [0, 0, 0])), scale(k, k, k))
}

// Held is an item held in one hand.
export interface Held {
  // The item's sprite, e.g. textures/items/diamond_sword.png, drawn extruded
  // and placed where the game places it, with the arm held forward. Left
  // out, the hand holds nothing; nor does geometry without the arm.
  item?: RgbaImage
  // Holds it as the game holds an item that is not a tool or weapon - food,
  // materials. False holds it upright, as a sword.
  flat?: boolean
  // Moves the item from where the game puts it, for an item that placement
  // does not suit.
  adjust?: ItemAdjust
}

// heldToModel maps item space to model units relative to the grip, in the
// geometry's frame: the hand's display, X mirrored and scaled by 16, then
// the caller's adjustment.
export function heldToModel(h: Held, side: Hand): Mat4 {
  const display = h.flat ? side.flat : side.tool
  return mul2(mul2(adjustMatrix(h.adjust), scale(-16.0, 16.0, 16.0)), display)
}

// Hand is what differs between the hands: the bone names, where a model
// without an item bone grips, and the game's display transforms.
export interface Hand {
  arm: string
  item: string
  // The item's own bone; no skin uses the name.
  bone: string
  gripX: number
  // Item space (blocks, the sprite's longer side one block) to the hand's
  // frame (blocks), as standard right-handed matrices: tools and weapons
  // upright, anything else flat.
  tool: Mat4
  flat: Mat4
}

// mulAll is the product of ms, left to right.
const mulAll = (ms: Mat4[]): Mat4 => ms.slice(1).reduce((out, m) => mul2(out, m), ms[0]!)

const translate = (x: number, y: number, z: number): Mat4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]
const scale = (x: number, y: number, z: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]

const DEG_TO_RAD = Math.PI / 180.0

// The standard right-handed rotations, in degrees - not raster's rotate,
// which turns the other way (see rotationMatrix).
function rotX(deg: number): Mat4 {
  const s = gomath.sin(deg * DEG_TO_RAD)
  const c = gomath.cos(deg * DEG_TO_RAD)
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}

function rotY(deg: number): Mat4 {
  const s = gomath.sin(deg * DEG_TO_RAD)
  const c = gomath.cos(deg * DEG_TO_RAD)
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}

function rotZ(deg: number): Mat4 {
  const s = gomath.sin(deg * DEG_TO_RAD)
  const c = gomath.cos(deg * DEG_TO_RAD)
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

// spriteItemTransform is the game's legacy item transform, applied before
// either display.
const spriteItemTransform = (): Mat4 => mulAll([scale(1.5, 1.5, 1.5), rotY(50.0), rotZ(335.0), translate(0.075, -0.245, -0.1)])

let handsCache: [Hand, Hand] | undefined

// hands are the right hand and the left, in that order. The left is the
// game's off hand: not a mirror of the right, but its own offset.
export function hands(): [Hand, Hand] {
  return (handsCache ??= [
    {
      arm: 'rightArm',
      item: 'rightItem',
      bone: 'bedrockskin:right_item',
      gripX: -1.0,
      tool: mulAll([scale(-1, -1, 1), rotY(180.0), translate(0.1, 0.265, 0), scale(0.625, 0.625, 0.625), rotX(80.0), rotY(45.0), spriteItemTransform()]),
      flat: mulAll([
        scale(-1, -1, 1),
        translate(0.3125, 0.1875, -0.1875),
        scale(0.375, 0.375, 0.375),
        rotZ(60.0),
        rotX(-90.0),
        rotZ(20.0),
        spriteItemTransform(),
      ]),
    },
    {
      arm: 'leftArm',
      item: 'leftItem',
      bone: 'bedrockskin:left_item',
      gripX: 1.0,
      tool: mulAll([
        scale(-1, -1, 1),
        translate(-0.125, 0, 0),
        rotY(180.0),
        translate(0, 0.265, 0),
        scale(0.625, 0.625, 0.625),
        rotX(80.0),
        rotY(45.0),
        spriteItemTransform(),
      ]),
      flat: mulAll([
        scale(-1, -1, 1),
        translate(-0.125, 0, 0),
        translate(0.3125, 0.1875, -0.1875),
        scale(0.375, 0.375, 0.375),
        rotZ(60.0),
        rotX(-90.0),
        rotZ(20.0),
        spriteItemTransform(),
      ]),
    },
  ])
}

// holdingPose is pose with the hand's arm held out as vanilla's
// animation.player.holding holds it: the arm's X turn becomes this*0.5 - 18,
// half its swing and 18 degrees forward. arm is the model's name for it.
export function holdingPose(h: Hand, pose: Pose, arm: string): Pose {
  const x = pose.of(arm).rotation[0]
  return pose.with([[h.arm, bonePose({ rotation: [-x * 0.5 - 18.0, 0, 0] })]])
}

// handSkeleton is geo's skeleton with no cubes, plus a bone at the hand's
// grip for the item: the model's item bone, else where the standard arm's
// would be. It comes with the model's name for the arm; undefined when geo
// has no such arm.
export function handSkeleton(h: Hand, geo: Geometry): { skel: Geometry; arm: string } | undefined {
  const byName = new Map<string, Bone>()
  for (const b of geo.bones) byName.set(b.name, b)
  let arm = geo.bones.find((b) => sameBone(b.name, h.arm))
  let grip = geo.bones.find((b) => sameBone(b.name, h.item))
  if (grip) {
    const parent = byName.get(grip.parent)
    if (parent) arm = parent
    else grip = undefined
  }
  if (!arm) return undefined
  const pivot = grip
    ? [at(grip.pivot, 0), at(grip.pivot, 1), at(grip.pivot, 2)]
    : [at(arm.pivot, 0) + h.gripX, at(arm.pivot, 1) - 7.0, at(arm.pivot, 2) + 1.0]
  const bones: Bone[] = geo.bones.map((b) => ({ ...newBone(), name: b.name, parent: b.parent, pivot: b.pivot, rotation: b.rotation }))
  bones.push({ ...newBone(), name: h.bone, parent: arm.name, pivot })
  const skel: Geometry = {
    identifier: h.bone,
    textureWidth: 0,
    textureHeight: 0,
    bones,
    visibleBoundsWidth: 0,
    visibleBoundsHeight: 0,
    visibleBoundsOffset: [],
  }
  return { skel, arm: arm.name }
}

// buildHeldItem is the sprite's triangles: a front and a back face over the
// whole sprite, and an edge strip along every side of an opaque texel that
// has no opaque neighbour there. Opaque means passing the shader's alpha
// test: alpha/255 >= 0.5, a byte of 128 or more.
export function buildHeldItem(item: RgbaImage, toModel: Mat4, world: Mat4): Triangle[] {
  const w = item.width
  const h = item.height
  if (w === 0 || h === 0) return []
  const t = 1.0 / Math.max(w, h)
  const vert = (x: number, y: number, z: number, u: number, v: number): Vertex => {
    const p = mulPosition(world, mulPosition(toModel, vec3(x, y, z)))
    // V is pre-flipped, as in addCube.
    return vertex(vec3(-p.x, p.y, p.z), u, 1.0 - v)
  }
  const tris: Triangle[] = []
  const quad = (a: Vertex, b: Vertex, c: Vertex, d: Vertex) => {
    tris.push([a, b, c])
    tris.push([a, c, d])
  }
  // Column c spans X from -c*t to -(c+1)*t, row r spans Y from (h-r)*t down
  // to (h-r-1)*t, and the slab runs from Z=0 back to Z=-t.
  const x0 = 0.0
  const x1 = -w * t
  const y1 = h * t
  for (const z of [0.0, -t]) {
    quad(vert(x0, 0, z, 0, 1), vert(x1, 0, z, 1, 1), vert(x1, y1, z, 1, 0), vert(x0, y1, z, 0, 0))
  }
  const pix = item.data
  const opaque = (c: number, r: number) => c >= 0 && r >= 0 && c < w && r < h && pix[(r * w + c) * 4 + 3]! >= 128
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!opaque(c, r)) continue
      const u = (c + 0.5) / w
      const v = (r + 0.5) / h
      const left = -c * t
      const right = -(c + 1) * t
      const top = (h - r) * t
      const bottom = (h - r - 1) * t
      const edge = (xa: number, ya: number, xb: number, yb: number) =>
        quad(vert(xa, ya, 0, u, v), vert(xa, ya, -t, u, v), vert(xb, yb, -t, u, v), vert(xb, yb, 0, u, v))
      if (!opaque(c - 1, r)) edge(left, bottom, left, top)
      if (!opaque(c + 1, r)) edge(right, bottom, right, top)
      if (!opaque(c, r - 1)) edge(left, top, right, top)
      if (!opaque(c, r + 1)) edge(left, bottom, right, bottom)
    }
  }
  return tris
}

// itemTriangles are an item on its own turned spin degrees about its
// upright axis, after its adjustment: item space centred on the origin, so
// the adjustment and the spin turn it about its middle; then into model
// units, X mirrored as a held item's is.
export function itemTriangles(item: RgbaImage, adjust: ItemAdjust | undefined, spin: number): Triangle[] {
  const w = item.width
  const h = item.height
  const t = 1.0 / gomath.max(w, h)
  const toModel = mulAll([rotationMatrix([0, spin, 0]), adjustMatrix(adjust), scale(-16.0, 16.0, 16.0), translate((w * t) / 2.0, (-h * t) / 2.0, t / 2.0)])
  return buildHeldItem(item, toModel, IDENTITY)
}
