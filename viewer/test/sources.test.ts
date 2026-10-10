import { describe, expect, it } from 'vitest'
import { isSkin, keyOf, skinKey, wireAnimation, wireJSON, wireSkin } from '../src/sources'

describe('inputs', () => {
  it('tells a skin from an image', () => {
    expect(isSkin({ texture: 'a.png' })).toBe(true)
    expect(isSkin({ hideSkin: true })).toBe(true)
    expect(isSkin({ width: 64, height: 64, data: new Uint8Array(4) })).toBe(false)
    expect(isSkin(new Uint8Array(4))).toBe(false)
    expect(isSkin(new Blob([]))).toBe(false)
    expect(isSkin(new URL('https://example.com/a.png'))).toBe(false)
  })

  it('reads JSON as a URL, text, bytes or an object', () => {
    expect(wireJSON('geo.json')).toEqual({ url: 'geo.json' })
    expect(wireJSON('  {"a":1}')).toEqual({ text: '  {"a":1}' })
    expect(wireJSON('null')).toEqual({ text: 'null' })
    expect(wireJSON({ a: [1] })).toEqual({ text: '{"a":[1]}' })
    const bytes = new Uint8Array([123, 125])
    expect(wireJSON(bytes)).toEqual({ bytes })
  })

  it('fills a whole set of armor from its two layers', async () => {
    const w = await wireSkin({ texture: 'skin.png', armor: { layer1: 'd1.png', layer2: 'd2.png', boots: 'gold.png' }, face: 'face.png', rightHand: 'sword.png' })
    expect(w.armor).toEqual({ helmet: 'd1.png', chestplate: 'd1.png', leggings: 'd2.png', boots: 'gold.png', elytra: undefined })
    expect(w.animated).toEqual([{ type: 1, texture: 'face.png' }])
    expect(w.rightHand).toEqual({ item: 'sword.png' })
    expect((await wireSkin('skin.png')).texture).toBe('skin.png')
  })

  it('keys equal inputs alike, and different ones apart', () => {
    const blob = new Blob(['x'])
    expect(skinKey({ texture: 'a.png', model: 'slim' })).toBe(skinKey({ model: 'slim', texture: 'a.png' }))
    expect(skinKey({ texture: 'a.png', model: 'slim' })).not.toBe(skinKey({ texture: 'a.png', model: 'wide' }))
    expect(skinKey('a.png')).toBe(skinKey({ texture: 'a.png' }))
    expect(skinKey({ texture: blob })).toBe(skinKey({ texture: blob }))
    expect(skinKey({ texture: blob })).not.toBe(skinKey({ texture: new Blob(['x']) }))
    expect(skinKey({ texture: 'a.png', geometry: { b: 1 } })).toBe(skinKey({ texture: 'a.png', geometry: { b: 1 } }))
    expect(skinKey(null)).toBe('')
    expect(keyOf(wireAnimation('walk'))).not.toBe(keyOf(wireAnimation(null)))
  })
})
