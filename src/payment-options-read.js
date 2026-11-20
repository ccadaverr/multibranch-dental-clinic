// Read-only gate for the Patient Review and Pay screen. The Laravel endpoint
// returns plain method names and a six-field optional address; the browser
// must not treat a malformed or incomplete response as permission to pay.
const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'postal_code', 'country']

export function paymentOptionsProjection(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Array.isArray(data.methods) || typeof data.can_save_billing_address !== 'boolean') return null
  const methods = data.methods
  if (methods.some(name => typeof name !== 'string' || !name.trim()) ||
      new Set(methods).size !== methods.length) return null
  const address = data.billing_address
  if (!address || typeof address !== 'object' || Array.isArray(address) ||
      ADDRESS_KEYS.some(key => typeof address[key] !== 'string')) return null
  return { methods: [...methods], billing_address: Object.fromEntries(ADDRESS_KEYS.map(key => [key, address[key]])),
    can_save_billing_address: data.can_save_billing_address }
}
