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
