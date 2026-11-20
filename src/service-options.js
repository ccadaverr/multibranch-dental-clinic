// Presentation-only grouping. API category values are authoritative; eligibility and
// branch availability still come from the existing scheduling APIs.
export function groupBookableServiceOptions(services = []) {
  const groups = new Map()
  for (const service of services) {
    const raw = typeof service?.category === 'string' ? service.category.trim() : ''
    const category = raw || 'Other services'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(service)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left === 'Other services' ? 1 : right === 'Other services' ? -1 : left.localeCompare(right))
    .map(([category, items]) => ({
      category,
      items: items.sort((a,b) => (a.name || '').localeCompare(b.name || '')),
    }))
}
