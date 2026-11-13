// Select by its controlled state identity, not JSX attribute order or formatting.
// Uses the JSX parser already installed with @vitejs/plugin-react; no downloads.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const { parse } = createRequire(import.meta.url)('@babel/parser')
export function choiceHandler(path, stateName, bindings) {
  const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
  const matches = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'JSXOpeningElement' && node.name.name === 'select') {
      const attributes = node.attributes
      if (attributes.some(a => a.name?.name === 'value' && a.value?.expression?.name === stateName)) {
        const handler = attributes.find(a => a.name?.name === 'onChange')?.value?.expression
        if (handler) matches.push(source.slice(handler.start, handler.end))
      }
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
  }
  visit(parse(source, { sourceType: 'module', plugins: ['jsx'] }))
  if (matches.length !== 1) throw Error(`Expected one controlled select for ${stateName}; found ${matches.length}`)
  return runInNewContext('(' + matches[0] + ')', bindings)
}
