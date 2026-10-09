import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cos, float64Bits, goInt, max, min, round, sin, tan } from '../src/gomath'

const hex = (f: number) => float64Bits(f).toString(16).padStart(16, '0')

describe('gomath', () => {
  // testdata/parity/trig.json holds what Go's math package returns, by bit
  // pattern, for a spread of inputs, huge ones included (tools/parity writes
  // it).
  it('matches Go bit for bit', () => {
    const cases = JSON.parse(readFileSync('testdata/parity/trig.json', 'utf8')) as {
      X: number
      Sin: string
      Cos: string
      Tan: string
    }[]
    expect(cases.length).toBeGreaterThan(100)
    for (const c of cases) {
      expect(hex(sin(c.X)), `sin(${c.X})`).toBe(c.Sin)
      expect(hex(cos(c.X)), `cos(${c.X})`).toBe(c.Cos)
      expect(hex(tan(c.X)), `tan(${c.X})`).toBe(c.Tan)
    }
  })

  it('min, max, round and int like Go', () => {
    expect(min(1, NaN)).toBeNaN()
    expect(min(NaN, -Infinity)).toBe(-Infinity)
    expect(Object.is(min(-0, 0), -0)).toBe(true)
    expect(Object.is(max(-0, 0), 0)).toBe(true)
    expect(round(-2.5)).toBe(-3)
    expect(round(2.5)).toBe(3)
    expect(Object.is(round(-0.4), -0)).toBe(true)
    expect(round(0.49999999999999994)).toBe(0)
    expect(goInt(NaN)).toBe(-(2 ** 63))
    expect(goInt(-2.7)).toBe(-2)
  })
})
