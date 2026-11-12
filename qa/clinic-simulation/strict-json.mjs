// Bounded JSON only. Never evaluate input; reject decoded duplicate keys before JSON.parse can discard them.
export class DescriptorError extends Error {
  constructor(code) { super(code); this.code = code }
}

// Only bounded, parsed JSON data; field ordering must not change an identity comparison.
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
  return JSON.stringify(value)
}

export function parseStrictJson(text) {
  const fail = code => { throw new DescriptorError(code) }
  if (typeof text !== 'string' || !text.isWellFormed() || Buffer.byteLength(text, 'utf8') > 1048576) fail('INVALID_JSON_INPUT')
  let at = 0, nodes = 0
  const white = () => { while (/[\x20\t\r\n]/.test(text[at] || '\0')) at++ }
  const string = () => {
    const start = at++
    while (at < text.length) {
      const ch = text[at++]
      if (ch === '"') {
        let value
        try { value = JSON.parse(text.slice(start, at)) } catch { fail('MALFORMED_JSON') }
        if (!value.isWellFormed()) fail('MALFORMED_JSON')
        return value
      }
      if (ch === '\\') at++
    }
    fail('MALFORMED_JSON')
  }
  const value = depth => {
    if (depth > 24 || ++nodes > 25000) fail('JSON_LIMIT_EXCEEDED')
    white()
    const ch = text[at]
    if (ch === '"') return string()
    if (ch === '{') {
      at++; white()
      const result = Object.create(null), keys = new Set()
      if (text[at] === '}') { at++; return result }
      while (at < text.length) {
        white(); if (text[at] !== '"') fail('MALFORMED_JSON')
        const key = string()
        if (keys.has(key)) fail('DUPLICATE_JSON_KEY')
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('UNSUPPORTED_FIELD')
        keys.add(key); white()
        if (text[at++] !== ':') fail('MALFORMED_JSON')
        result[key] = value(depth + 1); white()
        const end = text[at++]
        if (end === '}') return result
        if (end !== ',') fail('MALFORMED_JSON')
      }
      fail('MALFORMED_JSON')
    }
    if (ch === '[') {
      at++; white(); const result = []
      if (text[at] === ']') { at++; return result }
      while (at < text.length) {
        result.push(value(depth + 1)); white()
        const end = text[at++]
        if (end === ']') return result
        if (end !== ',') fail('MALFORMED_JSON')
      }
      fail('MALFORMED_JSON')
    }
    for (const [token, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, at)) { at += token.length; return parsed }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at))
    if (!number) fail('MALFORMED_JSON')
    at += number[0].length
    const parsed = Number(number[0])
    if (!Number.isFinite(parsed)) fail('MALFORMED_JSON')
    return parsed
  }
  const result = value(0)
  white(); if (at !== text.length) fail('MALFORMED_JSON')
  return result
}
