// String comparisons as Go makes them.

// compareBytes orders strings as Go does: by their UTF-8 bytes, which is
// code point order. JavaScript's < compares UTF-16 code units, which puts a
// character past U+FFFF (a surrogate pair) before U+E000-U+FFFF.
export function compareBytes(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const ca = a.codePointAt(i)!
    const cb = b.codePointAt(i)!
    if (ca !== cb) return ca < cb ? -1 : 1
    if (ca > 0xffff) i++
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

// sameBone compares bone names ignoring ASCII case, as Bedrock compares
// them: persona models name their limbs "leftarm" where vanilla says
// "leftArm".
export function sameBone(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    let x = a.charCodeAt(i)
    let y = b.charCodeAt(i)
    if (x >= 0x41 && x <= 0x5a) x += 0x20
    if (y >= 0x41 && y <= 0x5a) y += 0x20
    if (x !== y) return false
  }
  return true
}

// toLower is Go's strings.ToLower: each character lower-cased on its own.
// JavaScript's toLowerCase also reads context (a final capital sigma becomes
// ς) and maps \u0130 to two characters; Go does neither.
export function toLower(s: string): string {
  // Plain ASCII, the common case, lower-cases the same either way.
  if (/^[\x00-\x7f]*$/.test(s)) return s.toLowerCase()
  let out = ''
  for (const c of s) out += c === '\u0130' ? 'i' : c.toLowerCase()
  return out
}

// trimSpace is Go's strings.TrimSpace. JavaScript's trim also takes U+FEFF,
// and leaves U+0085.
export function trimSpace(s: string): string {
  let a = 0
  let b = s.length
  while (a < b && isGoSpace(s.charCodeAt(a))) a++
  while (b > a && isGoSpace(s.charCodeAt(b - 1))) b--
  return s.slice(a, b)
}

// isGoSpace is Go's unicode.IsSpace, what bytes.TrimSpace trims: not quite
// JavaScript's \s, which also takes U+FEFF.
export function isGoSpace(c: number): boolean {
  return (
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  )
}
