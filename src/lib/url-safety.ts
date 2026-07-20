import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function isReservedIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true
  }

  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  )
}

function isReservedIpv6(hostname: string): boolean {
  const value = hostnameWithoutBrackets(hostname).split('%')[0]
  if (value.startsWith('::')) return true
  if (/^f[cd]/.test(value)) return true
  if (/^fe[89ab]/.test(value)) return true
  if (value.startsWith('ff') || value.startsWith('2001:db8:')) return true

  const mappedIpv4 = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  return mappedIpv4 ? isReservedIpv4(mappedIpv4) : false
}

export function isUnsafeHostname(hostname: string): boolean {
  const value = hostnameWithoutBrackets(hostname)
  if (
    !value ||
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    (!value.includes('.') && isIP(value) === 0)
  ) {
    return true
  }

  const ipVersion = isIP(value)
  if (ipVersion === 4) return isReservedIpv4(value)
  if (ipVersion === 6) return isReservedIpv6(value)
  return false
}

export function isSafeRemoteUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      !isUnsafeHostname(url.hostname)
    )
  } catch {
    return false
  }
}

export async function assertSafeRemoteUrl(input: string): Promise<void> {
  if (!isSafeRemoteUrl(input)) throw new Error('Unsafe remote URL')

  const hostname = hostnameWithoutBrackets(new URL(input).hostname)
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Remote host could not be resolved')
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeHostname(address))) {
    throw new Error('Remote host resolves to a private or reserved address')
  }
}

/** Fetch an untrusted remote URL without following an unchecked redirect. */
export async function fetchSafeRemote(
  input: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let current = input
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertSafeRemoteUrl(current)
    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response

    const location = response.headers.get('location')
    if (!location) return response
    if (redirects === maxRedirects) throw new Error('Too many remote redirects')
    current = new URL(location, current).toString()
  }
  throw new Error('Too many remote redirects')
}

export function normalizeStorefrontDomain(input: string): string | null {
  const raw = input.trim()
  if (!raw || raw.length > 2_048) return null

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const hostname = hostnameWithoutBrackets(url.hostname)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password ||
      isIP(hostname) !== 0 ||
      isUnsafeHostname(hostname) ||
      hostname.length > 253 ||
      hostname.split('.').some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
    ) {
      return null
    }
    return hostname
  } catch {
    return null
  }
}

function comparableHostname(hostname: string): string {
  return hostnameWithoutBrackets(hostname).replace(/^www\./, '')
}

export function isStorefrontUrl(
  input: string,
  domain: string,
  options: { requireQueryPlaceholder?: boolean } = {},
): boolean {
  if (options.requireQueryPlaceholder && !input.includes('{query}')) return false

  const candidate = input.replaceAll('{query}', 'test')
  if (!isSafeRemoteUrl(candidate)) return false

  const configuredHost = comparableHostname(domain)
  const urlHost = comparableHostname(new URL(candidate).hostname)
  return urlHost === configuredHost || urlHost.endsWith(`.${configuredHost}`)
}

export function resolveSafeHttpUrl(input: string | undefined, base: string): string | undefined {
  if (!input?.trim()) return undefined
  try {
    const resolved = new URL(input, base).toString()
    return isSafeRemoteUrl(resolved) ? resolved : undefined
  } catch {
    return undefined
  }
}
