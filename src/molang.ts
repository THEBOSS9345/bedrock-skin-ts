// Molang: the small expression language Bedrock animations use for values
// that change over time, e.g. `math.sin(query.anim_time * 360) * 30`. See
// docs/animation.md#molang in bedrock-skin-go for what is supported.

import * as gomath from './gomath'
import { toLower } from './strings'

// Env is what an expression can read: queries by name (lower case, without
// the `query.` prefix) and the script's variables, which it can also set.
export class Env {
  readonly queries = new Map<string, number>()
  readonly variables = new Map<string, number>()

  get(name: string): number {
    if (name.startsWith('query.')) return this.queries.get(name.slice(6)) ?? 0
    if (name.startsWith('variable.') || name.startsWith('temp.') || name.startsWith('context.')) {
      return this.variables.get(name) ?? 0
    }
    return 0
  }
}

type Stmt = { kind: 'expr'; expr: Expr } | { kind: 'assign'; name: string; expr: Expr } | { kind: 'return'; expr: Expr }

type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'unary'; op: string; arg: Expr }
  | { kind: 'binary'; op: string; l: Expr; r: Expr }
  | { kind: 'ternary'; cond: Expr; yes: Expr; no: Expr }
  | { kind: 'call'; name: string; args: Expr[] }

const num = (value: number): Expr => ({ kind: 'number', value })

// Molang is a compiled expression or script.
export class Molang {
  private constructor(private readonly stmts: Stmt[]) {}

  static constant(v: number): Molang {
    return new Molang([{ kind: 'expr', expr: num(v) }])
  }

  // compile parses src, throwing a MolangError on a syntax error.
  static compile(src: string): Molang {
    const p = new Parser(src)
    const stmts: Stmt[] = []
    while (!p.at('eof')) {
      if (p.at('punct', ';')) {
        p.i++
        continue
      }
      stmts.push(p.statement())
      if (!p.at('eof') && !p.at('punct', ';')) throw p.error('expected ; or the end')
    }
    return new Molang(stmts)
  }

  // eval runs it. A single expression is its own value; a script of
  // statements is the value of its return statement, or 0.
  eval(env: Env): number {
    const only = this.stmts.length === 1 ? this.stmts[0]! : undefined
    if (only?.kind === 'expr') return finite(evalExpr(only.expr, env))
    for (const st of this.stmts) {
      switch (st.kind) {
        case 'assign':
          env.variables.set(st.name, finite(evalExpr(st.expr, env)))
          break
        case 'return':
          return finite(evalExpr(st.expr, env))
        case 'expr':
          evalExpr(st.expr, env)
      }
    }
    return 0
  }
}

// MolangError is a syntax error in an expression.
export class MolangError extends Error {
  override name = 'MolangError'
}

// finite keeps a NaN or infinity (a division by zero, say) from reaching the
// renderer, where it would make a vertex vanish.
const finite = (v: number) => (Number.isFinite(v) ? v : 0)

// ---- lexing ----

type Kind = 'eof' | 'num' | 'ident' | 'punct'

interface Tok {
  kind: Kind
  text: string
  num: number
  pos: number // in bytes, as the Go version counts
}

// Go reads the source a byte at a time and asks unicode about each byte as a
// rune, so a byte past ASCII is judged as the Latin-1 character it would be.
const isLetter = (b: number) => /\p{L}/u.test(String.fromCharCode(b))
const isSpace = (b: number) => (b >= 0x09 && b <= 0x0d) || b === 0x20 || b === 0x85 || b === 0xa0
const isDigit = (b: number) => b >= 0x30 && b <= 0x39

const TWO = ['==', '!=', '<=', '>=', '&&', '||', '??', '->']
const ONE = '+-*/()<>!?:,;='

const quote = (s: string) => JSON.stringify(s)

function lex(src: string): Tok[] {
  const bytes = new TextEncoder().encode(src)
  const decode = (i: number, j: number) => new TextDecoder().decode(bytes.subarray(i, j))
  const toks: Tok[] = []
  let i = 0
  while (i < bytes.length) {
    const c = bytes[i]!
    if (isSpace(c)) {
      i++
    } else if (isDigit(c) || (c === 0x2e && i + 1 < bytes.length && isDigit(bytes[i + 1]!))) {
      let j = i
      while (j < bytes.length && (isDigit(bytes[j]!) || bytes[j] === 0x2e)) j++
      if (j < bytes.length && (bytes[j] === 0x66 || bytes[j] === 0x46)) j++ // 1.5f, as some files write
      const text = decode(i, j)
      const digits = text.replace(/[fF]$/, '')
      // Go's ParseFloat: digits and at most one point. Too many digits to
      // fit a float64 is an error there too.
      const v = /^\d*\.?\d*$/.test(digits) ? Number(digits) : NaN
      if (!Number.isFinite(v)) throw new MolangError(`molang ${quote(src)} at ${i}: bad number ${quote(text)}`)
      toks.push({ kind: 'num', text: '', num: v, pos: i })
      i = j
    } else if (isLetter(c) || c === 0x5f) {
      let j = i
      while (j < bytes.length && (isLetter(bytes[j]!) || isDigit(bytes[j]!) || bytes[j] === 0x5f || bytes[j] === 0x2e)) j++
      toks.push({ kind: 'ident', text: normalizeName(decode(i, j)), num: 0, pos: i })
      i = j
    } else {
      const two = i + 1 < bytes.length ? String.fromCharCode(c, bytes[i + 1]!) : ''
      if (TWO.includes(two)) {
        toks.push({ kind: 'punct', text: two, num: 0, pos: i })
        i += 2
        continue
      }
      const one = String.fromCharCode(c)
      if (c < 0x80 && ONE.includes(one)) {
        toks.push({ kind: 'punct', text: one, num: 0, pos: i })
        i++
        continue
      }
      throw new MolangError(`molang ${quote(src)} at ${i}: unexpected ${quote(one)}`)
    }
  }
  toks.push({ kind: 'eof', text: '', num: 0, pos: bytes.length })
  return toks
}

// normalizeName lower-cases a name and expands Molang's short prefixes (q.,
// v., t., c.), so `Math.Cos` and `math.cos`, `q.anim_time` and
// `query.anim_time` are one name each.
function normalizeName(s: string): string {
  s = toLower(s)
  for (const [short, long] of [
    ['q.', 'query.'],
    ['v.', 'variable.'],
    ['t.', 'temp.'],
    ['c.', 'context.'],
  ] as const) {
    if (s.startsWith(short)) return long + s.slice(short.length)
  }
  return s
}

// ---- parsing ----

// Binary operators by precedence, loosest first.
const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/']]

class Parser {
  readonly toks: Tok[]
  i = 0

  constructor(readonly src: string) {
    this.toks = lex(src)
  }

  error(msg: string): MolangError {
    const pos = this.toks[this.i]?.pos ?? new TextEncoder().encode(this.src).length
    return new MolangError(`molang ${quote(this.src)} at ${pos}: ${msg}`)
  }

  peek(): Tok {
    return this.toks[this.i]!
  }

  at(kind: Kind, text = ''): boolean {
    const t = this.peek()
    return t.kind === kind && (text === '' || t.text === text)
  }

  statement(): Stmt {
    if (this.at('ident', 'return')) {
      this.i++
      return { kind: 'return', expr: this.expr() }
    }
    if (this.at('ident')) {
      const next = this.toks[this.i + 1]!
      if (next.kind === 'punct' && next.text === '=') {
        const name = this.peek().text
        this.i += 2
        return { kind: 'assign', name, expr: this.expr() }
      }
    }
    return { kind: 'expr', expr: this.expr() }
  }

  // Precedence, loosest first: ?? then ?: then || && then comparisons,
  // + -, * /, unary.
  expr(): Expr {
    let l = this.ternary()
    while (this.at('punct', '??')) {
      this.i++
      l = { kind: 'binary', op: '??', l, r: this.ternary() }
    }
    return l
  }

  ternary(): Expr {
    const cond = this.binary(0)
    if (!this.at('punct', '?')) return cond
    this.i++
    const yes = this.ternary()
    // "a ? b" with no ":" is 0 when false.
    let no = num(0)
    if (this.at('punct', ':')) {
      this.i++
      no = this.ternary()
    }
    return { kind: 'ternary', cond, yes, no }
  }

  binary(level: number): Expr {
    if (level === LEVELS.length) return this.unary()
    let l = this.binary(level + 1)
    for (;;) {
      const t = this.peek()
      const op = t.kind === 'punct' ? LEVELS[level]!.find((op) => op === t.text) : undefined
      if (op === undefined) return l
      this.i++
      l = { kind: 'binary', op, l, r: this.binary(level + 1) }
    }
  }

  unary(): Expr {
    for (const op of ['-', '!', '+']) {
      if (this.at('punct', op)) {
        this.i++
        return { kind: 'unary', op, arg: this.unary() }
      }
    }
    return this.primary()
  }

  primary(): Expr {
    const t = this.toks[this.i]!
    this.i++
    if (t.kind === 'num') return num(t.num)
    if (t.kind === 'punct' && t.text === '(') {
      const e = this.expr()
      if (!this.at('punct', ')')) throw this.error('expected )')
      this.i++
      return e
    }
    if (t.kind === 'ident') {
      if (t.text === 'true') return num(1)
      if (t.text === 'false') return num(0)
      if (t.text === 'math.pi') return num(Math.PI)
      if (this.at('punct', '(')) {
        this.i++
        const args: Expr[] = []
        while (!this.at('punct', ')')) {
          if (this.at('eof')) throw this.error('unexpected ""')
          args.push(this.expr())
          if (this.at('punct', ',')) this.i++
          else if (!this.at('punct', ')')) throw this.error('expected , or )')
        }
        this.i++
        if (t.text.startsWith('math.') && !MATH.has(t.text)) throw this.error(`unknown function ${t.text}`)
        return { kind: 'call', name: t.text, args }
      }
      return { kind: 'name', name: t.text }
    }
    this.i--
    throw this.error(`unexpected ${quote(t.text)}`)
  }
}

// ---- evaluation ----

const truth = (v: number) => v !== 0
const b2f = (b: boolean) => (b ? 1 : 0)

function evalExpr(e: Expr, env: Env): number {
  switch (e.kind) {
    case 'number':
      return e.value
    case 'name':
      return env.get(e.name)
    case 'unary': {
      const v = evalExpr(e.arg, env)
      return e.op === '-' ? -v : e.op === '!' ? b2f(!truth(v)) : v
    }
    case 'ternary':
      return truth(evalExpr(e.cond, env)) ? evalExpr(e.yes, env) : evalExpr(e.no, env)
    case 'call': {
      const vals = e.args.map((a) => evalExpr(a, env))
      const f = MATH.get(e.name)
      return f ? f(vals) : 0 // a query function this library does not model
    }
    case 'binary':
      switch (e.op) {
        // Short-circuiting.
        case '&&':
          return b2f(truth(evalExpr(e.l, env)) && truth(evalExpr(e.r, env)))
        case '||':
          return b2f(truth(evalExpr(e.l, env)) || truth(evalExpr(e.r, env)))
        // Every name here has a value (unknown ones are 0), so the left side
        // always stands.
        case '??':
          return evalExpr(e.l, env)
      }
      {
        const l = evalExpr(e.l, env)
        const r = evalExpr(e.r, env)
        switch (e.op) {
          case '+':
            return l + r
          case '-':
            return l - r
          case '*':
            return l * r
          case '/':
            return r === 0 ? 0 : l / r
          case '==':
            return b2f(l === r)
          case '!=':
            return b2f(l !== r)
          case '<':
            return b2f(l < r)
          case '>':
            return b2f(l > r)
          case '<=':
            return b2f(l <= r)
          case '>=':
            return b2f(l >= r)
        }
        return 0
      }
  }
}

const DEG = Math.PI / 180

const arg = (a: number[], i: number) => a[i] ?? 0

// fmod is Go's math.Mod: the remainder with the sign of x. JavaScript's %
// is the same exact operation.
const fmod = (x: number, y: number) => x % y

// MATH is Molang's math functions. Trigonometry is in degrees, as in
// Bedrock. random is the middle of its range, so a render is repeatable.
const MATH = new Map<string, (a: number[]) => number>([
  ['math.sin', (a) => gomath.sin(arg(a, 0) * DEG)],
  ['math.cos', (a) => gomath.cos(arg(a, 0) * DEG)],
  ['math.asin', (a) => gomath.asin(arg(a, 0)) / DEG],
  ['math.acos', (a) => gomath.acos(arg(a, 0)) / DEG],
  ['math.atan', (a) => gomath.atan(arg(a, 0)) / DEG],
  ['math.atan2', (a) => gomath.atan2(arg(a, 0), arg(a, 1)) / DEG],
  ['math.abs', (a) => Math.abs(arg(a, 0))],
  ['math.ceil', (a) => Math.ceil(arg(a, 0))],
  ['math.floor', (a) => Math.floor(arg(a, 0))],
  ['math.round', (a) => gomath.round(arg(a, 0))],
  ['math.trunc', (a) => Math.trunc(arg(a, 0))],
  ['math.sqrt', (a) => Math.sqrt(arg(a, 0))],
  ['math.exp', (a) => gomath.exp(arg(a, 0))],
  ['math.ln', (a) => gomath.log(arg(a, 0))],
  ['math.pow', (a) => gomath.pow(arg(a, 0), arg(a, 1))],
  ['math.mod', (a) => (arg(a, 1) === 0 ? 0 : fmod(arg(a, 0), arg(a, 1)))],
  ['math.min', (a) => gomath.min(arg(a, 0), arg(a, 1))],
  ['math.max', (a) => gomath.max(arg(a, 0), arg(a, 1))],
  ['math.clamp', (a) => gomath.max(arg(a, 1), gomath.min(arg(a, 2), arg(a, 0)))],
  ['math.lerp', (a) => arg(a, 0) + (arg(a, 1) - arg(a, 0)) * arg(a, 2)],
  [
    'math.lerprotate',
    (a) => {
      const from = arg(a, 0)
      const d = fmod(arg(a, 1) - from + 540, 360) - 180
      return from + d * arg(a, 2)
    },
  ],
  [
    'math.hermite_blend',
    (a) => {
      const t = arg(a, 0)
      return 3 * t * t - 2 * t * t * t
    },
  ],
  ['math.random', (a) => (arg(a, 0) + arg(a, 1)) / 2],
  ['math.random_integer', (a) => gomath.round((arg(a, 0) + arg(a, 1)) / 2)],
  ['math.die_roll', (a) => (arg(a, 0) * (arg(a, 1) + arg(a, 2))) / 2],
  ['math.die_roll_integer', (a) => gomath.round((arg(a, 0) * (arg(a, 1) + arg(a, 2))) / 2)],
  [
    'math.min_angle',
    (a) => {
      let v = fmod(arg(a, 0), 360)
      if (v >= 180) v -= 360
      else if (v < -180) v += 360
      return v
    },
  ],
])
