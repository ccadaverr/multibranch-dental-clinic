// Execute uniquely selected production expressions, rather than matching JSX
// formatting. Browser tests separately exercise mounting, focus and lifetimes.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
const { parse } = createRequire(import.meta.url)('@babel/parser')
export function productionExpression(file, select, bindings = {}) {
  const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
  const found = []
  function visit(node, parent, ancestors = []) {
    if (!node || typeof node !== 'object') return
    if (select(node, parent, ancestors)) found.push(node)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, node, [...ancestors, node]))
      else if (value && typeof value === 'object') visit(value, node, [...ancestors, node])
    }
  }
  visit(parse(source, { sourceType: 'module', plugins: ['jsx'] }))
  if (found.length !== 1) throw Error(`Expected one production expression in ${file}; found ${found.length}`)
  const expression = source.slice(found[0].start, found[0].end)
  const compiled = transformSync('(' + expression + ')', { loader: 'jsx', jsx: 'transform' }).code
  return runInNewContext(compiled, bindings)
}
export function variableValue(file, name, bindings, scope) {
  return productionExpression(file, (node, parent, ancestors) => parent?.type === 'VariableDeclarator' && parent.id.name === name && parent.init === node && (!scope || ancestors.some(a => a.type === 'FunctionDeclaration' && a.id?.name === scope)), bindings)
}
export function jsxAttribute(file, element, attribute, bindings, title) {
  const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] }), matches = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'JSXOpeningElement' && node.name.name === element && (!title || node.attributes.some(a => a.name?.name === 'title' && a.value?.value === title))) {
      const expression = node.attributes.find(a => a.name?.name === attribute)?.value?.expression
      if (expression) matches.push(expression)
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
  }
  visit(ast)
  if (matches.length !== 1) throw Error(`Expected one ${element}.${attribute}; found ${matches.length}`)
  return productionExpression(file, node => node.start === matches[0].start && node.type === matches[0].type, bindings)
}
