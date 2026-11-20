/** Pure draft validation: no network writes happen until the entire draft is valid. */
export function profileChangePlan(current, fields, photoAction, password, otp = '') {
  const first = (fields.first_name || '').trim().replace(/\s+/g, ' ')
  const last = (fields.last_name || '').trim().replace(/\s+/g, ' ')
  const normalizedCurrentFirst = (current?.first_name || '').trim().replace(/\s+/g, ' ')
  const normalizedCurrentLast = (current?.last_name || '').trim().replace(/\s+/g, ' ')
  const name = Boolean(current) && (first !== normalizedCurrentFirst || last !== normalizedCurrentLast)
  const photo = photoAction === 'replace' || photoAction === 'remove'
  const security = Object.values(password || {}).some(value => Boolean(value)) || Boolean(otp)
  return { name, photo, security, dirty: name || photo || security, first, last }
}

export function validateProfileDraft({ current, fields, photoAction, photoFile, password, otp, otpRequested, role }) {
  const plan = profileChangePlan(current, fields, photoAction, password, otp)
  if (!plan.dirty) return { plan, error: null }
  if (plan.name && (!plan.first || !plan.last || plan.first.length > 80 || plan.last.length > 80)) {
    return { plan, error: 'Enter a first and last name of no more than 80 characters each.' }
  }
  if (photoAction === 'replace' && (!photoFile || !['image/jpeg', 'image/png', 'image/webp'].includes(photoFile.type) || photoFile.size > 2 * 1024 * 1024 || photoFile.size <= 0)) {
    return { plan, error: 'Choose a JPG, PNG or WebP photo up to 2 MB.' }
  }
  if (plan.security) {
    if (!password.current_password || !password.password || !password.password_confirmation) return { plan, error: 'Complete all three password fields before saving.' }
    if (password.password.length < 8 || !/[a-z]/i.test(password.password) || !/\d/.test(password.password)) return { plan, error: 'Use at least 8 characters, including a letter and a number.' }
    if (password.password !== password.password_confirmation) return { plan, error: 'New passwords must match.' }
    if (role === 'patient' && (!otpRequested || !/^\d{6}$/.test(otp))) return { plan, error: 'Request and enter the six-digit email verification code.' }
  }
  return { plan, error: null }
}

export function profileSaveFailure(result, saved = []) {
  const reason = Object.values(result?.errors || {}).flat()[0] || result?.message || 'The server could not verify this change.'
  const prefix = saved.length ? `${saved.join(' and ')} saved. ` : ''
  return `${prefix}${reason} Any remaining changes have not been confirmed.`
}

/**
 * Save name then photo then password. Password is LAST because it revokes the session.
 * Every verified step is surfaced independently, so failures cannot be mistaken for an atomic save.
 */
export async function commitProfileDraft({ current, fields, photoAction, photoFile, password, otp, otpRequested, role, isCurrent, actions, onStep }) {
  const { plan, error } = validateProfileDraft({ current, fields, photoAction, photoFile, password, otp, otpRequested, role })
  if (error) return { ok: false, error, saved: [] }
  if (!plan.dirty) return { ok: true, saved: [] }
  const saved = []
  const fail = result => ({ ok: false, error: profileSaveFailure(result, saved), saved: [...saved] })
  const cancelled = () => ({ ok: false, cancelled: true, saved: [...saved] })
  try {
    if (!isCurrent()) return cancelled()
    if (plan.name) {
      const result = await actions.name({
        first_name: plan.first, last_name: plan.last,
        expected_first_name: current.first_name || '', expected_last_name: current.last_name || '',
      }, isCurrent)
      if (!isCurrent()) return cancelled()
      if (!result?.ok || result.data?.id !== current.id || result.data?.role !== role) return fail(result?.ok ? { message: 'The name response could not be verified. Reopen your profile before trying again.' } : result)
      saved.push('Name')
      onStep?.('name', result.data)
    }
    if (plan.photo) {
      const result = photoAction === 'replace'
        ? await actions.photoUpload(photoFile, isCurrent)
        : await actions.photoRemove(isCurrent)
      if (!isCurrent()) return cancelled()
      if (!result?.ok || (photoAction === 'replace' ? result.data?.updated !== true : result.data?.removed !== true)) return fail(result?.ok ? { message: 'The photo response could not be verified. Reopen your profile before trying again.' } : result)
      saved.push('Photo')
      onStep?.('photo')
    }
    if (plan.security) {
      const result = role === 'patient'
        ? await actions.patientPassword({ ...password, otp }, isCurrent)
        : await actions.password(password, isCurrent)
      if (!isCurrent()) return cancelled()
      if (!result?.ok || (role !== 'patient' && result.data?.sign_in_required !== true)) return fail(result?.ok ? { message: 'The password response could not be verified. Check your session before retrying.' } : result)
      saved.push('Password')
      onStep?.('password')
    }
    return { ok: true, saved }
  } catch {
    return fail({ message: 'Connection interrupted. Check which changes were saved before retrying.' })
  }
}

/** Validate image dimensions before making any account writes; server validates again. */
export async function validateProfilePhotoDimensions(file, decoder = typeof createImageBitmap === 'function' ? createImageBitmap : null) {
  if (!file) return 'Choose a photo before saving.'
  try {
    if (decoder) {
      const image = await decoder(file)
      const dimensions = { width: image.width, height: image.height }
      image.close?.()
      return dimensions.width > 0 && dimensions.height > 0 && dimensions.width <= 3000 && dimensions.height <= 3000
        ? null : 'Choose an image no larger than 3000 × 3000 pixels.'
    }
    if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return 'Your browser cannot verify the selected photo.'
    return await new Promise(resolve => {
      const url = URL.createObjectURL(file)
      const image = new Image()
      const finish = error => { URL.revokeObjectURL(url); resolve(error) }
      image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth <= 3000 && image.naturalHeight <= 3000
        ? null : 'Choose an image no larger than 3000 × 3000 pixels.')
      image.onerror = () => finish('The selected photo could not be opened.')
      image.src = url
    })
  } catch {
    return 'The selected photo could not be opened.'
  }
}
