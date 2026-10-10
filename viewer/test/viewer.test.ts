// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { SkinViewer } from '../src/viewer'

const texture = new Uint8Array(readFileSync('../testdata/bench-skin/texture.png'))
const viewers: SkinViewer[] = []
const make = (opts: ConstructorParameters<typeof SkinViewer>[1] = {}) => {
  const el = document.createElement('div')
  document.body.append(el)
  const v = new SkinViewer(el, { worker: false, ...opts })
  viewers.push(v)
  return { v, el }
}
afterEach(() => {
  for (const v of viewers.splice(0)) v.destroy()
})

describe('SkinViewer', () => {
  it('loads a skin and an animation set one straight after the other', async () => {
    const { v, el } = make()
    const a = v.setSkin(texture)
    const b = v.setAnimation('walk')
    await Promise.all([a, b])
    expect(v.info?.frames).toBe(20)
    expect(el.getAttribute('data-state')).toBe('ready')
    // And again the other way round, on a fresh viewer: the engine's cache
    // must not have kept a still pose under "walk".
    const { v: w } = make({ animation: 'walk' })
    await w.setSkin(texture)
    expect(w.info?.frames).toBe(20)
  })

  it('does nothing when given the same skin again', async () => {
    const { v } = make()
    const loads: number[] = []
    v.on('load', (i) => loads.push(i.frames))
    await v.setSkin({ texture, model: 'slim' })
    await v.setSkin({ model: 'slim', texture })
    expect(loads).toHaveLength(1)
  })

  it('reports errors and recovers', async () => {
    const { v, el } = make()
    const errors: string[] = []
    v.on('error', (e) => errors.push(e.message))
    await expect(v.setSkin(new Uint8Array([1, 2, 3]))).rejects.toThrow(/skin/)
    expect(el.getAttribute('data-state')).toBe('error')
    expect(errors).toHaveLength(1)
    await v.setSkin(texture)
    expect(v.state).toBe('ready')
    expect(v.error).toBeNull()
  })

  it('moves the camera within its limits', () => {
    const { v } = make({ controls: { maxPitch: 30, maxZoom: 2 } })
    const moves: number[] = []
    v.on('camera', (c) => moves.push(c.yaw))
    v.setCamera({ yaw: 90, pitch: 80, zoom: 9 })
    expect(v.camera).toEqual({ yaw: 90, pitch: 30, zoom: 2 })
    v.setView('back')
    expect(v.camera.yaw).toBe(180)
    v.resetCamera()
    expect(v.camera).toEqual({ yaw: 25, pitch: 10, zoom: 1 })
    expect(moves).toEqual([90, 180, 25])
    v.autoRotate = true
    expect(v.autoRotate).toBe(30)
    v.setControls(false)
    expect(v.controls).toBeNull()
  })

  it('lists animations and cleans up', async () => {
    const { v, el } = make()
    const list = await v.animations()
    expect(list.motions).toContain('walk')
    expect(list.examples).toContain('dance')
    v.destroy()
    expect(el.querySelector('canvas')).toBeNull()
    expect(el.hasAttribute('data-state')).toBe(false)
  })
})

describe('SkinViewer extras', () => {
  it('plays an animation written in code', async () => {
    const { v } = make({ fps: 10 })
    const seen: number[] = []
    const nod = { duration: 1.5, pose: (t: number) => (seen.push(t), { head: { rotation: [Math.sin(t * Math.PI) * 30, 0, 0] as [number, number, number] }, rightArm: { scale: 1.2 } }) }
    await v.setSkin(texture)
    await v.setAnimation(nod)
    expect(v.info?.frames).toBe(15)
    expect(seen).toHaveLength(15)
    // The same object again changes nothing; another one with the same
    // shape is another animation.
    await v.setAnimation(nod)
    expect(seen).toHaveLength(15)
    await v.setAnimation({ ...nod, pose: () => ({}) })
    expect(v.info?.frames).toBe(15)
  })

  it('changes one part of the skin at a time', async () => {
    const { v } = make()
    await v.setSkin({ texture, cape: texture })
    await v.loadSkin(texture, { model: 'slim' })
    expect(v.skin).toMatchObject({ texture, cape: texture, model: 'slim' })
    await v.loadCape(null)
    await v.loadItem('right', texture)
    await v.loadArmor({ helmet: texture })
    expect(v.skin).toMatchObject({ texture, model: 'slim', cape: undefined, rightHand: texture, armor: { helmet: texture } })
    expect(v.state).toBe('ready')
    v.animation = 'wave'
    expect(v.animation).toBe('wave')
  })

  it('sets a background, a name tag and a size', () => {
    const { v, el } = make({ background: '#123456', nameTag: { text: 'Steve', color: 'gold', font: 'serif' }, width: 200, height: '300px' })
    expect(v.canvas.style.background).toContain('#123456')
    const tag = el.querySelector('.bsv-nametag') as HTMLElement
    expect(tag.textContent).toBe('Steve')
    expect(tag.style.color).toBe('gold')
    expect([el.style.width, el.style.height]).toEqual(['200px', '300px'])
    v.background = { image: 'sky.png' }
    expect(v.canvas.style.background).toContain('sky.png')
    v.nameTag = null
    expect(el.querySelector('.bsv-nametag')).toBeNull()
  })
})

describe('frame rate', () => {
  it('changes while the viewer runs', async () => {
    const { v } = make({ fps: 10 })
    await v.setSkin(texture)
    await v.setAnimation('walk')
    expect(v.info?.frames).toBe(10)
    v.fps = 60
    await new Promise((r) => v.on('load', r))
    expect([v.fps, v.info?.frames, v.info?.fps]).toEqual([60, 60, 60])
    v.fps = 500
    expect(v.fps).toBe(60)
  })
})
