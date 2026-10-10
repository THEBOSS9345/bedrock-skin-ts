// The drawing engine: it loads a skin's files, prepares its animation with
// bedrock-skin, and draws frames from whatever camera the viewer asks for.
// It runs in the viewer's Web Worker, or on the page where a worker cannot
// start; handle() is the whole of it.

import {
  bonePose,
  decodeImage,
  defaultGeometry,
  encodePNG,
  exampleAnimations,
  isEmpty,
  Motion,
  parseAnimations,
  parseGeometry,
  parseResourcePatch,
  Pose,
  prepareFrames,
  selectGeometry,
  textureFromRGBA,
  type Animation,
  type Animator,
  type Armor,
  type Frames,
  type Held,
  type RenderOptions,
  type RgbaImage,
} from 'bedrock-skin'
import type { AnimationInfo, Request, Response, WireAnimation, WireHeld, WireImage, WireJSON, WirePose, WireSkin } from './protocol'

// lru is a map that forgets its least recently used entry past max.
function lru<V>(max: number) {
  const m = new Map<string, V>()
  return {
    get(k: string): V | undefined {
      const v = m.get(k)
      if (v !== undefined) {
        m.delete(k)
        m.set(k, v)
      }
      return v
    },
    set(k: string, v: V) {
      m.delete(k)
      m.set(k, v)
      if (m.size > max) m.delete(m.keys().next().value!)
    },
    delete: (k: string) => void m.delete(k),
  }
}

// Kept across every viewer the engine draws for: a gallery of viewers
// showing one skin loads it once.
const skins = lru<Promise<RenderOptions>>(32)
const animations = lru<Promise<{ animator: Animator; file: string[] }>>(16)

// ---- loading files ----

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`could not load ${url}: ${r.status} ${r.statusText}`.trim())
  return new Uint8Array(await r.arrayBuffer())
}

const isPNG = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

const asBytes = (v: ArrayBuffer | ArrayBufferView): Uint8Array =>
  v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)

// pixelsOf reads a decoded bitmap's pixels, unpremultiplied.
function pixelsOf(bmp: ImageBitmap): RgbaImage {
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('cannot read the image: no 2D canvas here')
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height)
  return { width: d.width, height: d.height, data: d.data }
}

// decodeAny decodes an image file: PNGs exactly, by bedrock-skin, as the
// game's own skins are; anything else (JPEG, WebP) by the browser.
async function decodeAny(bytes: Uint8Array): Promise<RgbaImage> {
  if (isPNG(bytes)) return decodeImage(bytes)
  if (typeof createImageBitmap !== 'function') throw new Error('only PNG images can be read here')
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  } catch {
    throw new Error('not an image: give a PNG, or a JPEG or WebP')
  }
  return pixelsOf(bmp)
}

async function image(src: WireImage): Promise<RgbaImage> {
  if (typeof src === 'string') return decodeAny(await fetchBytes(src))
  if (typeof Blob !== 'undefined' && src instanceof Blob) return decodeAny(new Uint8Array(await src.arrayBuffer()))
  if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) return decodeAny(asBytes(src as ArrayBuffer | ArrayBufferView))
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) return pixelsOf(src)
  const px = src as { width: number; height: number; data: ArrayLike<number> & { buffer: ArrayBufferLike } }
  const data = px.data instanceof Uint8Array || px.data instanceof Uint8ClampedArray ? px.data : Uint8Array.from(px.data)
  return textureFromRGBA(data, px.width, px.height)
}

async function jsonBytes(src: WireJSON): Promise<Uint8Array | string> {
  if ('text' in src) return src.text
  if ('url' in src) return fetchBytes(src.url)
  const b = src.bytes
  if (typeof Blob !== 'undefined' && b instanceof Blob) return new Uint8Array(await b.arrayBuffer())
  return asBytes(b as ArrayBuffer | ArrayBufferView)
}

// MODELS are the names a viewer may give for the two standard bodies.
const MODELS: Record<string, string> = {
  wide: 'geometry.humanoid.custom',
  classic: 'geometry.humanoid.custom',
  steve: 'geometry.humanoid.custom',
  slim: 'geometry.humanoid.customSlim',
  alex: 'geometry.humanoid.customSlim',
}

async function held(h: WireHeld | undefined, what: string): Promise<Held | undefined> {
  if (!h) return undefined
  return { item: await named(what, h.item), flat: h.flat, adjust: h.adjust }
}

// named loads an image, naming it in any error.
async function named(what: string, src: WireImage): Promise<RgbaImage> {
  try {
    return await image(src)
  } catch (e) {
    throw new Error(`${what}: ${message(e)}`)
  }
}

async function loadSkin(s: WireSkin): Promise<RenderOptions> {
  if (!s.texture && !s.hideSkin) throw new Error('no skin texture')
  // Each distinct armor image is loaded once: a set shares one between
  // pieces.
  const armorImages = new Map<WireImage, Promise<RgbaImage>>()
  const piece = (name: string, src: WireImage | undefined) => {
    if (src === undefined) return undefined
    let p = armorImages.get(src)
    if (!p) armorImages.set(src, (p = named(`armor ${name}`, src)))
    return p
  }
  const a = s.armor ?? {}
  const [texture, geometry, patch, cape, animated, helmet, chestplate, leggings, boots, elytra, rightHand, leftHand] = await Promise.all([
    s.texture ? named('skin', s.texture) : undefined,
    s.geometry ? jsonBytes(s.geometry) : undefined,
    s.resourcePatch ? jsonBytes(s.resourcePatch) : undefined,
    s.cape ? named('cape', s.cape) : undefined,
    Promise.all((s.animated ?? []).map(async (x) => ({ type: x.type, texture: await named(`animation ${x.type}`, x.texture) }))),
    piece('helmet', a.helmet),
    piece('chestplate', a.chestplate),
    piece('leggings', a.leggings),
    piece('boots', a.boots),
    piece('elytra', a.elytra),
    held(s.rightHand, 'right hand item'),
    held(s.leftHand, 'left hand item'),
  ])
  let identifier = s.model ? (MODELS[s.model.toLowerCase()] ?? s.model) : ''
  if (!identifier && patch !== undefined) {
    try {
      identifier = parseResourcePatch(patch).default
    } catch {
      // A patch that does not read picks no entry: the one with the most
      // cubes is used, as for none.
    }
  }
  const armor: Armor = { helmet, chestplate, leggings, boots, elytra }
  return {
    texture: texture ?? { width: 0, height: 0, data: new Uint8Array(0) },
    geometry: geometry === undefined || isEmpty(geometry) ? undefined : parseGeometry(geometry),
    identifier,
    cape,
    animated,
    armor: Object.values(armor).some(Boolean) ? armor : undefined,
    rightHand,
    leftHand,
    scale: s.scale,
    hideSkin: s.hideSkin,
  }
}

// ---- animations ----

// STILL is a model standing at rest: one frame.
const STILL: Animator = { duration: () => 0, pose: () => new Pose() }

let examples: ReadonlyMap<string, Animation> | undefined
const example = (name: string) => {
  examples ??= exampleAnimations()
  return examples.get(name) ?? examples.get(`animation.player.${name}`)
}

// posed is an animation written in code: its frames posed on the page, one
// per frame at the rate it was prepared at.
function posed(a: { poses: WirePose[]; duration: number }, fps: number): Animator {
  const table = a.poses.map((frame) => new Pose(frame.map(([bone, m]) => [bone, bonePose({ rotation: m.rotation, position: m.position, scale: m.scale })])))
  const n = Math.max(table.length, 1)
  return {
    duration: () => a.duration,
    pose: (t) => table[((Math.round(t * fps) % n) + n) % n] ?? new Pose(),
  }
}

async function loadAnimation(a: WireAnimation, fps: number): Promise<{ animator: Animator; file: string[] }> {
  if (typeof a === 'object' && 'poses' in a) return { animator: posed(a, fps), file: [] }
  if (typeof a === 'string') {
    const name = a.trim()
    if (name === '' || name === 'none') return { animator: STILL, file: [] }
    const m = Motion.all.find((m) => m.name === name.toLowerCase() || (name.toLowerCase() === 'crouch' && m.name === 'sneak'))
    if (m) return { animator: m, file: [] }
    const e = example(name)
    if (e) return { animator: e, file: [] }
    throw new Error(`no animation named ${JSON.stringify(name)}: use a motion (walk, idle, wave, sneak), an example, or a file`)
  }
  const parsed = parseAnimations(await jsonBytes(a.file))
  const names = [...parsed.keys()]
  const pick = a.name === undefined ? parsed.get(names[0]!) : (parsed.get(a.name) ?? parsed.get(`animation.${a.name}`))
  if (!pick) throw new Error(`the file has no animation ${JSON.stringify(a.name)}; it has ${names.join(', ')}`)
  return { animator: pick, file: names }
}

function cached<V>(cache: ReturnType<typeof lru<Promise<V>>>, key: string, load: () => Promise<V>): Promise<V> {
  let p = cache.get(key)
  if (!p) {
    p = load()
    // A failure is not kept: the next ask tries again.
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

// topOf is where a name tag goes: just above the topmost drawn pixel, and
// across, the middle of everything drawn in a band below that - the head,
// not a strand of hair or a horn that happens to stick up highest.
function topOf(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number } | undefined {
  let top = -1
  for (let y = 0; y < h && top < 0; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] !== 0) {
        top = y
        break
      }
    }
  }
  if (top < 0) return undefined
  // The band: about a head's height at the default zoom.
  const band = Math.max(2, Math.round(h * 0.08))
  let sum = 0
  let count = 0
  for (let y = top; y < Math.min(h, top + band); y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] !== 0) {
        sum += x + 0.5
        count++
      }
    }
  }
  return { x: sum / count / w, y: top / h }
}

// ---- viewers ----

interface State {
  seq: number
  frames?: Frames
  info?: AnimationInfo
}

const viewers = new Map<number, State>()

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^bedrock-skin: /, '')

// handle answers one request, with what its answer transfers.
export async function handle(q: Request): Promise<{ res: Response; transfer?: Transferable[] }> {
  try {
    switch (q.op) {
      case 'load': {
        const st = viewers.get(q.viewer) ?? { seq: 0 }
        viewers.set(q.viewer, st)
        st.seq = Math.max(st.seq, q.seq)
        const [opts, anim] = await Promise.all([cached(skins, q.skinKey, () => loadSkin(q.skin)), cached(animations, typeof q.animation === 'string' ? `name:${q.animation}` : `other:${q.animKey}|${q.fps}`, () => loadAnimation(q.animation, q.fps))])
        // A newer load was asked for meanwhile: this one is out of date.
        if (q.seq !== st.seq) return { res: { id: q.id, ok: true, stale: true } }
        const frames = prepareFrames({ ...opts, animation: anim.animator, fps: q.fps })
        let missingBones: string[] = []
        if ('missingBones' in anim.animator) {
          const body = selectGeometry(opts.geometry?.length ? opts.geometry : defaultGeometry(), opts.identifier ?? '')
          if (body) missingBones = (anim.animator as Animation).missingBones(body)
        }
        st.frames = frames
        st.info = { frames: frames.length, fps: q.fps, missingBones, fileAnimations: anim.file }
        return { res: { id: q.id, ok: true, info: st.info } }
      }
      case 'draw':
      case 'png': {
        const frames = viewers.get(q.viewer)?.frames
        if (!frames) throw new Error('nothing loaded')
        const img = frames.draw(q.i, q.size, q.camera)
        if (q.op === 'png') {
          const png = encodePNG(img)
          return { res: { id: q.id, ok: true, png }, transfer: [png.buffer] }
        }
        const data = img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data)
        // Measured on the first frame, so a tag stays put while the model
        // moves under it, as the game's does.
        const top = q.measure
          ? topOf(q.i % frames.length === 0 ? data : (frames.draw(0, q.size, q.camera).data as Uint8ClampedArray), img.width, img.height)
          : undefined
        return { res: { id: q.id, ok: true, width: img.width, height: img.height, data, top }, transfer: [data.buffer] }
      }
      case 'list': {
        examples ??= exampleAnimations()
        return { res: { id: q.id, ok: true, motions: Motion.all.map((m) => m.name), examples: [...examples.keys()] } }
      }
      case 'drop':
        viewers.delete(q.viewer)
        return { res: { id: q.id, ok: true } }
    }
  } catch (e) {
    return { res: { id: q.id, ok: false, error: message(e) } }
  }
}
