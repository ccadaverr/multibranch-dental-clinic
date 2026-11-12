import {canonicalJson} from './strict-json.mjs'

// The bounded subset used by run-manifest.schema.json. This is not a general JSON Schema engine.
// Unknown schema vocabulary fails instead of being silently ignored.
const vocabulary = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum'])
export function assertSchemaVocabulary(schema) {
  for (const key of Object.keys(schema)) if (!vocabulary.has(key)) throw Error('Unsupported schema vocabulary')
  for (const key of ['properties', '$defs']) for (const child of Object.values(schema[key] || {})) assertSchemaVocabulary(child)
  if (schema.items) assertSchemaVocabulary(schema.items)
}

export function schemaIssues(data, schema, document = schema, location = '') {
  if (schema.$ref) {
    const name = /^#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/.exec(schema.$ref)?.[1]
    if (!name || !document.$defs?.[name]) throw Error('Unsupported schema reference')
    return schemaIssues(data, document.$defs[name], document, location)
  }
  const issue = code => [{code, location}]
  const kind = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data
  const expected = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (schema.type && !expected.some(t => t === kind || t === 'integer' && Number.isSafeInteger(data))) return issue('INVALID_EVIDENCE')
  if (Object.hasOwn(schema, 'const') && data !== schema.const) return issue('INVALID_EVIDENCE')
  if (schema.enum && !schema.enum.includes(data)) return issue('INVALID_EVIDENCE')
  if (kind === 'string') {
    if (data.length < (schema.minLength ?? 0) || data.length > (schema.maxLength ?? Infinity)) return issue('INVALID_EVIDENCE')
    // Compare the whole match: JS "$" alone also permits a final newline.
    if (schema.pattern && new RegExp(schema.pattern, 'u').exec(data)?.[0] !== data) return issue('INVALID_EVIDENCE')
  }
  if (kind === 'number' && (data < (schema.minimum ?? -Infinity) || data > (schema.maximum ?? Infinity))) return issue('INVALID_EVIDENCE')
  if (kind === 'array') {
    if (data.length < (schema.minItems ?? 0) || data.length > (schema.maxItems ?? Infinity)) return issue('INVALID_EVIDENCE')
    const issues = schema.uniqueItems && new Set(data.map(canonicalJson)).size !== data.length ? issue('DUPLICATE_EVIDENCE') : []
    return issues.concat(data.flatMap((x, i) => schemaIssues(x, schema.items, document, `${location}/${i}`)))
  }
  if (kind === 'object') {
    const issues = []
    for (const key of schema.required || []) if (!Object.hasOwn(data, key)) issues.push({code:'MISSING_EVIDENCE', location:`${location}/${key}`})
    // Do not disclose unknown keys: a caller might have placed a secret in a property name.
    if (schema.additionalProperties === false && Object.keys(data).some(k => !Object.hasOwn(schema.properties || {}, k))) issues.push(...issue('UNSUPPORTED_FIELD'))
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(data, key)) issues.push(...schemaIssues(data[key], child, document, `${location}/${key}`))
    return issues
  }
  return []
}
