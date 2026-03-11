const DRIVE_PATH_REGEX = /^[A-Za-z]:\//u,
  MULTI_SLASH_REGEX = /\/+/gu,
  normalizeSlashes = (value: string) => value.replaceAll('\\', '/'),
  trimLeadingSlash = (value: string) => {
    let result = value
    while (result.startsWith('/')) result = result.slice(1)
    return result
  },
  trimTrailingSlash = (value: string) => {
    let result = value
    while (result.endsWith('/') && result.length > 1) result = result.slice(0, -1)
    return result
  },
  fromFileUrl = (value: string) => {
    if (!value.startsWith('file://')) return normalizeSlashes(value)
    const pathname = decodeURIComponent(new URL(value).pathname),
      normalized = normalizeSlashes(pathname)
    if (DRIVE_PATH_REGEX.test(normalized.slice(1))) return normalized.slice(1)
    return normalized
  },
  joinPath = (...parts: string[]) => {
    if (parts.length === 0) return ''
    const normalizedParts: string[] = []
    for (const part of parts) {
      const normalized = normalizeSlashes(part)
      if (normalized.length > 0) normalizedParts.push(normalized)
    }
    if (normalizedParts.length === 0) return ''
    const first = normalizedParts[0] ?? '',
      isAbsolute = first.startsWith('/') || DRIVE_PATH_REGEX.test(first),
      [head, ...tail] = normalizedParts,
      segments = [trimTrailingSlash(head ?? '')]
    for (const segment of tail) segments.push(trimLeadingSlash(trimTrailingSlash(segment)))
    const joined = segments.join('/').replace(MULTI_SLASH_REGEX, '/'),
      withAbsolute = isAbsolute && !joined.startsWith('/') && !DRIVE_PATH_REGEX.test(joined) ? `/${joined}` : joined
    return withAbsolute
  },
  dirnamePath = (value: string) => {
    const normalized = trimTrailingSlash(normalizeSlashes(value)),
      lastSlash = normalized.lastIndexOf('/')
    if (lastSlash === -1) return '.'
    if (lastSlash === 0) return '/'
    return normalized.slice(0, lastSlash)
  },
  isAbsolutePath = (value: string) => {
    const normalized = normalizeSlashes(value)
    return normalized.startsWith('/') || DRIVE_PATH_REGEX.test(normalized)
  }
export { dirnamePath, fromFileUrl, isAbsolutePath, joinPath }
