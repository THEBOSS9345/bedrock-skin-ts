// Reading JSON values the way Go's encoding/json fills a struct, which is how
// the Go version reads geometry: object keys match field names exactly or
// ignoring case, a later key overwrites an earlier one, null leaves a
// number, string or bool as it was and empties a list, unknown keys are
// ignored, and a value of the wrong type is noted but does not stop the rest
// being read. Callers decide what a noted type error means, as the Go code
// does with the error json.Unmarshal returns.
//
// Each read takes the value and what the field holds now, and returns what
// it holds after.

import { JsonObject, type JsonValue } from './json'

export class Reader {
  typeError = false

  f64(v: JsonValue, cur: number): number {
    if (v === null) return cur
    // A number too big for a float64 is Go's "cannot unmarshal number".
    if (typeof v === 'number' && Number.isFinite(v)) return v
    this.typeError = true
    return cur
  }

  // optF64 is a *float64: null makes it unset.
  optF64(v: JsonValue, cur: number | undefined): number | undefined {
    if (v === null) return undefined
    const before = this.typeError
    this.typeError = false
    const f = this.f64(v, 0)
    const ok = !this.typeError
    this.typeError ||= before
    return ok ? f : cur
  }

  string(v: JsonValue, cur: string): string {
    if (v === null) return cur
    if (typeof v === 'string') return v
    this.typeError = true
    return cur
  }

  bool(v: JsonValue, cur: boolean): boolean {
    if (v === null) return cur
    if (typeof v === 'boolean') return v
    this.typeError = true
    return cur
  }

  f64s(v: JsonValue, cur: number[]): number[] {
    return this.list(v, cur, () => 0, (item, f) => this.f64(item, f))
  }

  // list reads a slice: each element into a fresh zero value, null clearing
  // it.
  list<T>(v: JsonValue, cur: T[], zero: () => T, read: (item: JsonValue, t: T) => T): T[] {
    if (Array.isArray(v)) return v.map((item) => read(item, zero()))
    if (v === null) return []
    this.typeError = true
    return cur
  }

  // object passes an object's entries, in order, to field with each key
  // lower-cased for matching. Null leaves the target as it was.
  object(v: JsonValue, field: (key: string, v: JsonValue) => void): void {
    if (v instanceof JsonObject) {
      for (const [key, val] of v.entries) field(key.toLowerCase(), val)
    } else if (v !== null) {
      this.typeError = true
    }
  }

  // map reads a map with string keys: entries keyed exactly, a repeat
  // replacing the earlier one where it stands, null clearing it.
  map<T>(v: JsonValue, cur: Map<string, T>, zero: () => T, read: (v: JsonValue, t: T) => T): Map<string, T> {
    if (v instanceof JsonObject) {
      const out = new Map(cur)
      for (const [key, val] of v.entries) out.set(key, read(val, zero()))
      return out
    }
    if (v === null) return new Map()
    this.typeError = true
    return cur
  }
}

// readF64s reads a list of numbers as Go reads one into []float64:
// undefined on a type error.
export function readF64s(v: JsonValue): number[] | undefined {
  const r = new Reader()
  const out = r.f64s(v, [])
  return r.typeError ? undefined : out
}
