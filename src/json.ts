// A JSON parser that keeps what Go's encoding/json sees, which is how the Go
// version reads geometry and animation files.
//
// JSON.parse will not do: it moves object keys that look like integers
// ("0", "1") ahead of the rest, where Go reads keys in file order (animation
// keyframes are keyed by time), and it keeps only the last of a repeated
// key, where Go reads each in turn. So objects keep every entry, in order.
//
// The grammar is Go's: no comments, no trailing commas, no byte order mark.
// A string's lone surrogate escape becomes U+FFFD, as in Go. A number too
// big for a float64 parses as an infinity, which the readers report as a
// value of the wrong type, as Go's decoder does.

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject

// JsonObject is an object's entries, in file order, repeats included.
export class JsonObject {
  constructor(readonly entries: [string, JsonValue][]) {}

  // get is the value of the last entry named key exactly, as a repeated key
  // ends up in Go: the later overwrites the earlier.
  get(key: string): JsonValue | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!
      if (e[0] === key) return e[1]
    }
    return undefined
  }
}

export const isObject = (v: JsonValue | undefined): v is JsonObject => v instanceof JsonObject

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`json: ${message} at offset ${offset}`)
    this.name = 'JsonSyntaxError'
  }
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

// text is input as a string. Bytes are decoded as UTF-8, invalid sequences
// becoming U+FFFD as Go's decoder makes them; a byte order mark is kept, so
// it fails the parse as it does in Go.
export function text(raw: Uint8Array | string): string {
  return typeof raw === 'string' ? raw : decoder.decode(raw)
}

export function parseJSON(raw: Uint8Array | string): JsonValue {
  const p = new Parser(text(raw))
  p.space()
  const v = p.value()
  p.space()
  if (p.i < p.s.length) p.fail('invalid character after top-level value')
  return v
}

class Parser {
  i = 0
  constructor(readonly s: string) {}

  fail(msg: string): never {
    throw new JsonSyntaxError(msg, this.i)
  }

  space() {
    const s = this.s
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i)
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.i++
      else break
    }
  }

  value(): JsonValue {
    const c = this.s[this.i]
    switch (c) {
      case '{':
        return this.object()
      case '[':
        return this.array()
      case '"':
        return this.string()
      case 't':
        return this.literal('true', true)
      case 'f':
        return this.literal('false', false)
      case 'n':
        return this.literal('null', null)
      case undefined:
        return this.fail('unexpected end of JSON input')
    }
    if (c === '-' || (c >= '0' && c <= '9')) return this.number()
    return this.fail(`invalid character ${JSON.stringify(c)} looking for beginning of value`)
  }

  literal<T>(word: string, v: T): T {
    if (this.s.startsWith(word, this.i)) {
      this.i += word.length
      return v
    }
    return this.fail('invalid literal')
  }

  object(): JsonObject {
    this.i++ // {
    const entries: [string, JsonValue][] = []
    this.space()
    if (this.s[this.i] === '}') {
      this.i++
      return new JsonObject(entries)
    }
    for (;;) {
      this.space()
      if (this.s[this.i] !== '"') this.fail('looking for beginning of object key string')
      const key = this.string()
      this.space()
      if (this.s[this.i] !== ':') this.fail("after object key, expected ':'")
      this.i++
      this.space()
      entries.push([key, this.value()])
      this.space()
      const c = this.s[this.i]
      this.i++
      if (c === ',') continue
      if (c === '}') return new JsonObject(entries)
      this.i--
      this.fail("after object key:value pair, expected ',' or '}'")
    }
  }

  array(): JsonValue[] {
    this.i++ // [
    const out: JsonValue[] = []
    this.space()
    if (this.s[this.i] === ']') {
      this.i++
      return out
    }
    for (;;) {
      this.space()
      out.push(this.value())
      this.space()
      const c = this.s[this.i]
      this.i++
      if (c === ',') continue
      if (c === ']') return out
      this.i--
      this.fail("after array element, expected ',' or ']'")
    }
  }

  number(): number {
    const s = this.s
    const start = this.i
    const digit = () => {
      const c = s.charCodeAt(this.i)
      return c >= 0x30 && c <= 0x39
    }
    if (s[this.i] === '-') this.i++
    if (s[this.i] === '0') this.i++
    else if (digit()) while (digit()) this.i++
    else this.fail('in numeric literal')
    if (s[this.i] === '.') {
      this.i++
      if (!digit()) this.fail('after decimal point in numeric literal')
      while (digit()) this.i++
    }
    if (s[this.i] === 'e' || s[this.i] === 'E') {
      this.i++
      if (s[this.i] === '+' || s[this.i] === '-') this.i++
      if (!digit()) this.fail('in exponent of numeric literal')
      while (digit()) this.i++
    }
    // Number() rounds correctly, as Go's strconv.ParseFloat does.
    return Number(s.slice(start, this.i))
  }

  string(): string {
    const s = this.s
    this.i++ // "
    let out = ''
    let run = this.i
    for (;;) {
      if (this.i >= s.length) this.fail('unexpected end of JSON input')
      const c = s.charCodeAt(this.i)
      if (c === 0x22) {
        out += s.slice(run, this.i)
        this.i++
        return out
      }
      if (c < 0x20) this.fail('invalid character in string literal')
      if (c !== 0x5c) {
        this.i++
        continue
      }
      out += s.slice(run, this.i)
      this.i++ // backslash
      const e = s[this.i]
      this.i++
      switch (e) {
        case '"':
        case '\\':
        case '/':
          out += e
          break
        case 'b':
          out += '\b'
          break
        case 'f':
          out += '\f'
          break
        case 'n':
          out += '\n'
          break
        case 'r':
          out += '\r'
          break
        case 't':
          out += '\t'
          break
        case 'u': {
          let u = this.hex4()
          if (u >= 0xd800 && u < 0xdc00) {
            // A high surrogate: a pair only with a low one escaped after it.
            if (s.startsWith('\\u', this.i)) {
              const save = this.i
              this.i += 2
              const lo = this.hex4()
              if (lo >= 0xdc00 && lo < 0xe000) {
                out += String.fromCharCode(u, lo)
                break
              }
              this.i = save
            }
            u = 0xfffd
          } else if (u >= 0xdc00 && u < 0xe000) {
            u = 0xfffd
          }
          out += String.fromCharCode(u)
          break
        }
        default:
          this.i--
          this.fail('invalid character in string escape code')
      }
      run = this.i
    }
  }

  hex4(): number {
    const h = this.s.slice(this.i, this.i + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail('invalid character in \\u hexadecimal character escape')
    this.i += 4
    return parseInt(h, 16)
  }
}
