// Go's math.Sin, math.Cos, math.Tan, math.Atan, math.Asin, math.Acos,
// math.Atan2, math.Min, math.Max and math.Round, ported line for line.
//
// The Go version of this library computes its camera and every animation
// with these, and JavaScript's Math.sin, Math.cos and Math.tan are only
// required to be close: engines round the last bit differently. One bit is
// enough to move an edge pixel, so this port uses Go's implementations to
// draw the same images bit for bit. See docs/design-decisions.md in
// bedrock-skin-go, "Why Go's trigonometry".

const PI4A = 7.85398125648498535156e-1 // 0x3fe921fb40000000, Pi/4 split into three parts
const PI4B = 3.77489470793079817668e-8 // 0x3e64442d00000000
const PI4C = 2.69515142907905952645e-15 // 0x3ce8469898cc5170

const FOUR_OVER_PI = 4 / Math.PI // 0x3ff45f306dc9c883, as Go folds 4/Pi

const SIN = [
  1.58962301576546568060e-10, -2.50507477628578072866e-8, 2.75573136213857245213e-6, -1.98412698295895385996e-4,
  8.33333333332211858878e-3, -1.66666666666666307295e-1,
] as const

const COS = [
  -1.13585365213876817300e-11, 2.08757008419747316778e-9, -2.75573141792967388112e-7, 2.48015872888517045348e-5,
  -1.38888888888730564116e-3, 4.16666666666665929218e-2,
] as const

const TAN_P = [-1.30936939181383777646e4, 1.15351664838587416140e6, -1.79565251976484877988e7] as const

const TAN_Q = [1.0, 1.36812963470692954678e4, -1.32089234440210967447e6, 2.50083801823357915839e7, -5.38695755929454629881e7] as const

const REDUCE_THRESHOLD = 2 ** 29

function sinPoly(z: number, zz: number): number {
  return z + z * zz * ((((((SIN[0] * zz) + SIN[1]) * zz + SIN[2]) * zz + SIN[3]) * zz + SIN[4]) * zz + SIN[5])
}

function cosPoly(zz: number): number {
  return 1.0 - 0.5 * zz + zz * zz * ((((((COS[0] * zz) + COS[1]) * zz + COS[2]) * zz + COS[3]) * zz + COS[4]) * zz + COS[5])
}

// reduce gives the octant and the angle within it, for x >= 0.
function reduce(x: number, wrap: boolean): [number, number] {
  if (x >= REDUCE_THRESHOLD) return trigReduce(x)
  let j = Math.trunc(x * FOUR_OVER_PI)
  let y = j
  if (j % 2 === 1) {
    j += 1
    y += 1.0
  }
  if (wrap) j %= 8
  return [j, ((x - y * PI4A) - y * PI4B) - y * PI4C]
}

export function sin(x: number): number {
  if (x === 0 || Number.isNaN(x)) return x
  if (!Number.isFinite(x)) return NaN
  let sign = false
  if (x < 0) {
    sign = true
    x = -x
  }
  let [j, z] = reduce(x, true)
  if (j > 3) {
    sign = !sign
    j -= 4
  }
  const zz = z * z
  const y = j === 1 || j === 2 ? cosPoly(zz) : sinPoly(z, zz)
  return sign ? -y : y
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN
  let sign = false
  let [j, z] = reduce(Math.abs(x), true)
  if (j > 3) {
    j -= 4
    sign = !sign
  }
  if (j > 1) sign = !sign
  const zz = z * z
  const y = j === 1 || j === 2 ? sinPoly(z, zz) : cosPoly(zz)
  return sign ? -y : y
}

export function tan(x: number): number {
  if (x === 0 || Number.isNaN(x)) return x
  if (!Number.isFinite(x)) return NaN
  let sign = false
  if (x < 0) {
    sign = true
    x = -x
  }
  const [j, z] = reduce(x, false)
  const zz = z * z
  let y =
    zz > 1e-14
      ? z + z * (zz * (((TAN_P[0] * zz) + TAN_P[1]) * zz + TAN_P[2]) / ((((zz + TAN_Q[1]) * zz + TAN_Q[2]) * zz + TAN_Q[3]) * zz + TAN_Q[4]))
      : z
  if ((j & 2) === 2) y = -1.0 / y
  return sign ? -y : y
}

const M_PI4 = [
  0x0000000000000001n, 0x45f306dc9c882a53n, 0xf84eafa3ea69bb81n, 0xb6c52b3278872083n, 0xfca2c757bd778ac3n,
  0x6e48dc74849ba5c0n, 0x0c925dd413a32439n, 0xfc3bd63962534e7dn, 0xd1046bea5d768909n, 0xd338e04d68befc82n,
  0x7323ac7306a673e9n, 0x3908bf177bf25076n, 0x3ff12fffbc0b301fn, 0xde5e2316b414da3en, 0xda6cfd9e4f96136en,
  0x9e8c7ecd3cbfd45an, 0xea4f758fd7cbe2f6n, 0x7a0e73ef14a525d4n, 0xd7f6bf623f1aba10n, 0xac06608df8f6d757n,
] as const

const U64 = (1n << 64n) - 1n

// Go's shifts on a uint64: shifting by 64 or more gives 0.
const shl = (x: bigint, n: bigint) => (n >= 64n ? 0n : (x << n) & U64)
const shr = (x: bigint, n: bigint) => (n >= 64n ? 0n : x >> n)

const bits = new DataView(new ArrayBuffer(8))

export function float64Bits(f: number): bigint {
  bits.setFloat64(0, f)
  return bits.getBigUint64(0)
}

export function float64FromBits(b: bigint): number {
  bits.setBigUint64(0, b)
  return bits.getFloat64(0)
}

function leadingZeros64(x: bigint): bigint {
  if (x === 0n) return 64n
  return BigInt(64 - x.toString(2).length)
}

// trigReduce is Payne-Hanek range reduction by Pi/4 for huge x, as Go's
// trigReduce. It only runs for |x| >= 2^29, so BigInt's cost does not matter.
function trigReduce(x: number): [number, number] {
  const PI4 = Math.PI / 4
  const SHIFT = 52n
  const MASK = 0x7ffn
  const BIAS = 1023n
  if (x < PI4) return [0, x]
  let ix = float64Bits(x)
  const exp = ((ix >> SHIFT) & MASK) - BIAS - SHIFT
  ix &= ~(MASK << SHIFT) & U64
  ix |= 1n << SHIFT
  const digit = Number((exp + 61n) / 64n)
  const bitshift = (exp + 61n) % 64n
  const m = (i: number) => M_PI4[i] as bigint
  const z0 = shl(m(digit), bitshift) | shr(m(digit + 1), 64n - bitshift)
  const z1 = shl(m(digit + 1), bitshift) | shr(m(digit + 2), 64n - bitshift)
  const z2 = shl(m(digit + 2), bitshift) | shr(m(digit + 3), 64n - bitshift)
  const z2hi = (z2 * ix) >> 64n
  const p1 = z1 * ix
  const z1hi = p1 >> 64n
  const z1lo = p1 & U64
  const z0lo = (z0 * ix) & U64
  const sum = z1lo + z2hi
  const lo = sum & U64
  const carry = sum >> 64n
  let hi = (z0lo + z1hi + carry) & U64
  let j = hi >> 61n
  hi = ((hi << 3n) & U64) | (lo >> 61n)
  const lz = leadingZeros64(hi)
  const e = (BIAS - (lz + 1n)) & U64
  hi = shl(hi, lz + 1n) | shr(lo, 64n - (lz + 1n))
  hi >>= 64n - SHIFT
  hi |= (e << SHIFT) & U64
  let z = float64FromBits(hi)
  if ((j & 1n) === 1n) {
    j += 1n
    j &= 7n
    z -= 1.0
  }
  return [Number(j), z * PI4]
}

function xatan(x: number): number {
  const P0 = -8.750608600031904122785e-1
  const P1 = -1.615753718733365076637e1
  const P2 = -7.500855792314704667340e1
  const P3 = -1.228866684490136173410e2
  const P4 = -6.485021904942025371773e1
  const Q0 = 2.485846490142306297962e1
  const Q1 = 1.650270098316988542046e2
  const Q2 = 4.328810604912902668951e2
  const Q3 = 4.853903996359136964868e2
  const Q4 = 1.945506571482613964425e2
  let z = x * x
  z = (z * ((((P0 * z + P1) * z + P2) * z + P3) * z + P4)) / (((((z + Q0) * z + Q1) * z + Q2) * z + Q3) * z + Q4)
  return x * z + x
}

// satan is atan of a positive x, reduced to [0, 0.66].
function satan(x: number): number {
  const MOREBITS = 6.123233995736765886130e-17 // pi/2 = PIO2 + Morebits
  const TAN3PIO8 = 2.41421356237309504880 // tan(3*pi/8)
  if (x <= 0.66) return xatan(x)
  if (x > TAN3PIO8) return Math.PI / 2 - xatan(1.0 / x) + MOREBITS
  return Math.PI / 4 + xatan((x - 1.0) / (x + 1.0)) + 0.5 * MOREBITS
}

export function atan(x: number): number {
  if (x === 0) return x
  return x > 0 ? satan(x) : -satan(-x)
}

export function asin(x: number): number {
  if (x === 0) return x
  let sign = false
  if (x < 0) {
    sign = true
    x = -x
  }
  if (x > 1.0) return NaN
  let temp = Math.sqrt(1.0 - x * x)
  temp = x > 0.7 ? Math.PI / 2 - satan(temp / x) : satan(x / temp)
  return sign ? -temp : temp
}

export function acos(x: number): number {
  return Math.PI / 2 - asin(x)
}

const isNegative = (x: number) => x < 0 || Object.is(x, -0)
const copysign = (mag: number, sign: number) => (isNegative(sign) ? -Math.abs(mag) : Math.abs(mag))

export function atan2(y: number, x: number): number {
  if (Number.isNaN(y) || Number.isNaN(x)) return NaN
  if (y === 0) {
    if (x >= 0 && !isNegative(x)) return copysign(0, y)
    return copysign(Math.PI, y)
  }
  if (x === 0) return copysign(Math.PI / 2, y)
  if (!Number.isFinite(x)) {
    if (x > 0) return !Number.isFinite(y) ? copysign(Math.PI / 4, y) : copysign(0, y)
    return !Number.isFinite(y) ? copysign((3 * Math.PI) / 4, y) : copysign(Math.PI, y)
  }
  if (!Number.isFinite(y)) return copysign(Math.PI / 2, y)
  const q = atan(y / x)
  if (x < 0) return q <= 0 ? q + Math.PI : q - Math.PI
  return q
}

// min is Go's math.Min: -Inf beats NaN, NaN beats everything else, and -0 is
// less than +0. JavaScript's Math.min agrees on NaN and zeros but is kept to
// Go's code so the two read the same.
export function min(x: number, y: number): number {
  if (x === -Infinity || y === -Infinity) return -Infinity
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (x === 0 && x === y) return isNegative(x) ? x : y
  return x < y ? x : y
}

// max is Go's math.Max, the mirror of min.
export function max(x: number, y: number): number {
  if (x === Infinity || y === Infinity) return Infinity
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (x === 0 && x === y) return isNegative(x) ? y : x
  return x > y ? x : y
}

// round is Go's math.Round: halves away from zero. Math.round rounds -2.5 to
// -2; Go to -3.
export function round(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x
  const t = Math.trunc(x)
  if (Math.abs(x - t) >= 0.5) return t + Math.sign(x)
  return t === 0 ? copysign(0, x) : t
}

// goInt is Go's int(f) on amd64: the conversion gives the minimum int64 for
// NaN and anything out of range. JavaScript has no int64, so that minimum is
// returned as a number: -2^63, exactly representable.
export function goInt(f: number): number {
  if (Number.isNaN(f) || f >= 9.223372036854775807e18 || f < -9.223372036854775808e18) return -(2 ** 63)
  return Math.trunc(f)
}

// exp, log and pow are Go's math.Exp, math.Log and math.Pow, for Molang's
// math.exp, math.ln and math.pow. As with the trigonometry, JavaScript's
// own are only required to be close. These are Go's portable versions; on
// amd64 Go swaps in assembly for Exp and Log (Log's computes the same; Exp's
// is a different method, and differs again with FMA), so Go is not
// bit-identical across machines here either.

export function exp(x: number): number {
  const LN2_HI = 6.93147180369123816490e-1
  const LN2_LO = 1.90821492927058770002e-10
  const LOG2E = 1.44269504088896338700e0
  const OVERFLOW = 7.09782712893383973096e2
  const UNDERFLOW = -7.45133219101941108420e2
  const NEAR_ZERO = 1.0 / (1 << 28)
  if (Number.isNaN(x)) return x
  if (x > OVERFLOW) return Infinity
  if (x < UNDERFLOW) return 0
  if (-NEAR_ZERO < x && x < NEAR_ZERO) return 1 + x
  let k = 0
  if (x < 0) k = Math.trunc(LOG2E * x - 0.5)
  else if (x > 0) k = Math.trunc(LOG2E * x + 0.5)
  const hi = x - k * LN2_HI
  const lo = k * LN2_LO
  return expmulti(hi, lo, k)
}

function expmulti(hi: number, lo: number, k: number): number {
  const P1 = 1.66666666666666657415e-1
  const P2 = -2.77777777770155933842e-3
  const P3 = 6.61375632143793436117e-5
  const P4 = -1.65339022054652515390e-6
  const P5 = 4.13813679705723846039e-8
  const r = hi - lo
  const t = r * r
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
  const y = 1 - (lo - (r * c) / (2 - c) - hi)
  return ldexp(y, k)
}

export function log(x: number): number {
  const LN2_HI = 6.93147180369123816490e-1
  const LN2_LO = 1.90821492927058770002e-10
  const L1 = 6.666666666666735130e-1
  const L2 = 3.999999999940941908e-1
  const L3 = 2.857142874366239149e-1
  const L4 = 2.222219843214978396e-1
  const L5 = 1.818357216161805012e-1
  const L6 = 1.531383769920937332e-1
  const L7 = 1.479819860511658591e-1
  if (Number.isNaN(x) || x === Infinity) return x
  if (x < 0) return NaN
  if (x === 0) return -Infinity
  let [f1, ki] = frexp(x)
  if (f1 < Math.SQRT2 / 2) {
    f1 *= 2
    ki--
  }
  const f = f1 - 1
  const k = ki
  const s = f / (2 + f)
  const s2 = s * s
  const s4 = s2 * s2
  const t1 = s2 * (L1 + s4 * (L3 + s4 * (L5 + s4 * L7)))
  const t2 = s4 * (L2 + s4 * (L4 + s4 * L6))
  const R = t1 + t2
  const hfsq = 0.5 * f * f
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f)
}

function isOddInt(x: number): boolean {
  if (Math.abs(x) >= 2 ** 53) return false
  return Number.isInteger(x) && Math.abs(x) % 2 === 1
}

export function pow(x: number, y: number): number {
  if (y === 0 || x === 1) return 1
  if (y === 1) return x
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (x === 0) {
    if (y < 0) return isNegative(x) && isOddInt(y) ? -Infinity : Infinity
    if (y > 0) return isNegative(x) && isOddInt(y) ? x : 0
  } else if (!Number.isFinite(y)) {
    if (x === -1) return 1
    return (Math.abs(x) < 1) === (y === Infinity) ? 0 : Infinity
  } else if (!Number.isFinite(x)) {
    if (x === -Infinity) return pow(1 / x, -y) // Pow(-0, -y)
    if (y < 0) return 0
    if (y > 0) return Infinity
  } else if (y === 0.5) {
    return Math.sqrt(x)
  } else if (y === -0.5) {
    return 1 / Math.sqrt(x)
  }
  let yi = Math.trunc(Math.abs(y))
  let yf = Math.abs(y) - yi
  if (yf !== 0 && x < 0) return NaN
  if (yi >= 2 ** 63) {
    if (x === -1) return 1
    return (Math.abs(x) < 1) === (y > 0) ? 0 : Infinity
  }
  // ans = a1 * 2**ae (= 1 for now).
  let a1 = 1.0
  let ae = 0
  // ans *= x**yf
  if (yf !== 0) {
    if (yf > 0.5) {
      yf--
      yi++
    }
    a1 = exp(yf * log(x))
  }
  // ans *= x**yi, by repeated squaring, keeping the exponent apart.
  let [x1, xe] = frexp(x)
  for (let i = BigInt(yi); i !== 0n; i >>= 1n) {
    if (xe < -(1 << 12) || 1 << 12 < xe) {
      // Catastrophic overflow: ldexp below sees it.
      ae += xe
      break
    }
    if ((i & 1n) === 1n) {
      a1 *= x1
      ae += xe
    }
    x1 *= x1
    xe <<= 1
    if (x1 < 0.5) {
      x1 += x1
      xe--
    }
  }
  // ans = a1 * 2**ae; if y < 0 { ans = 1 / ans }, the 1/ on a1 alone, as
  // it is normalized.
  if (y < 0) {
    a1 = 1 / a1
    ae = -ae
  }
  return ldexp(a1, ae)
}

// frexp is Go's math.Frexp: f as a fraction in [0.5, 1) times 2**exp.
export function frexp(f: number): [number, number] {
  if (f === 0 || !Number.isFinite(f)) return [f, 0]
  let e = 0
  if (Math.abs(f) < 2.2250738585072014e-308) {
    // Subnormal: normalize first, as Go does.
    f *= 2 ** 52
    e = -52
  }
  const b = float64Bits(f)
  e += Number((b >> 52n) & 0x7ffn) - 1022
  return [float64FromBits((b & ~(0x7ffn << 52n)) | (1022n << 52n)), e]
}

// ldexp is Go's math.Ldexp: frac * 2**exp, rounded once.
export function ldexp(frac: number, e: number): number {
  if (frac === 0 || !Number.isFinite(frac)) return frac
  const [f, fe] = frexp(frac)
  e += fe
  // f is in [0.5, 1): the result is f * 2**e.
  if (e < -1074) return copysign(0, frac) // underflow, as Go: below -1075 with f's bias
  if (e > 1024) return frac < 0 ? -Infinity : Infinity
  if (e < -1021) {
    // Subnormal: one rounding, in the multiply by 2**-53, as Go.
    return f * 2 ** (e + 53) * 2 ** -53
  }
  return f * 2 ** e
}
