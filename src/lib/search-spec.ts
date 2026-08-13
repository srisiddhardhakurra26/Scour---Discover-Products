import type { NormalizedListing } from './adapters/types'
import { parsePriceBounds } from './llm/query-parser'
import { explicitProductList } from './product-list'

export type SearchKind = 'product' | 'list' | 'mission'
export type ProductRole = 'exact' | 'substitute' | 'complement' | 'irrelevant'
export type ProductCondition = 'new' | 'used' | 'refurbished' | 'open-box' | 'any'

export type SearchTarget = {
  query: string
  productType?: string
  brand?: string
  model?: string
}

/**
 * The deterministic contract shared by retrieval and ranking. An LLM may add
 * optional preferences later, but it must never reverse these hard constraints.
 */
export type SearchSpec = {
  rawQuery: string
  refinedQuery: string
  kind: SearchKind
  targets: SearchTarget[]
  productType?: string
  brand?: string
  model?: string
  must: string[]
  should: string[]
  mustNot: string[]
  compatibility: string[]
  condition: ProductCondition
  minPriceMinor?: number
  maxPriceMinor?: number
  confidence: number
}

export type ProductRoleDecision = {
  role: ProductRole
  eligible: boolean
  confidence: number
  reasons: string[]
}

export type ClassifiedListing = {
  listing: NormalizedListing
  decision: ProductRoleDecision
}

type ProductDefinition = {
  type: string
  phrases: string[]
}

const PRODUCT_DEFINITIONS: ProductDefinition[] = [
  { type: 'game console', phrases: ['game console', 'gaming console', 'console'] },
  { type: 'controller', phrases: ['game controller', 'wireless controller', 'controller', 'gamepad'] },
  { type: 'video game', phrases: ['video game', 'game disc', 'game code'] },
  { type: 'monitor arm', phrases: ['monitor arm'] },
  { type: 'monitor stand', phrases: ['monitor stand', 'monitor riser'] },
  { type: 'monitor', phrases: ['computer monitor', 'gaming monitor', 'display monitor', 'monitor'] },
  { type: 'docking station', phrases: ['usb c docking station', 'docking station', 'laptop dock', 'usb c dock', 'dock'] },
  { type: 'laptop backpack', phrases: ['laptop backpack'] },
  { type: 'backpack', phrases: ['backpack', 'rucksack'] },
  { type: 'tote bag', phrases: ['tote bag', 'tote'] },
  { type: 'chair mat', phrases: ['chair mat'] },
  { type: 'chair', phrases: ['office chair', 'gaming chair', 'desk chair', 'chair'] },
  { type: 'boots', phrases: ['chelsea boots', 'hiking boots', 'work boots', 'ankle boots', 'boot', 'boots'] },
  { type: 'shoes', phrases: ['running shoes', 'walking shoes', 'sneakers', 'shoe', 'shoes'] },
  { type: 'headphones', phrases: ['over-ear headphones', 'headphones', 'headset'] },
  { type: 'earbuds', phrases: ['wireless earbuds', 'earbuds', 'earphones'] },
  { type: 'phone case', phrases: ['phone case'] },
  { type: 'phone', phrases: ['smartphone', 'mobile phone', 'phone'] },
  { type: 'laptop sleeve', phrases: ['laptop sleeve'] },
  { type: 'laptop', phrases: ['notebook computer', 'laptop'] },
  { type: 'tablet', phrases: ['tablet'] },
  { type: 'keyboard', phrases: ['mechanical keyboard', 'gaming keyboard', 'keyboard'] },
  { type: 'mouse', phrases: ['gaming mouse', 'computer mouse', 'mouse'] },
  { type: 'watch band', phrases: ['watch band', 'watch strap'] },
  { type: 'watch', phrases: ['gps running watch', 'running watch', 'fitness watch', 'smartwatch', 'gps watch', 'watch'] },
  { type: 'desk', phrases: ['standing desk', 'office desk', 'computer desk', 'desk'] },
  { type: 'lamp', phrases: ['task lamp', 'desk lamp', 'floor lamp', 'lamp'] },
  { type: 'coffee grinder', phrases: ['coffee grinder'] },
  { type: 'coffee maker', phrases: ['coffee maker', 'coffee machine'] },
  { type: 'jacket', phrases: ['jacket', 'coat'] },
  { type: 'shirt', phrases: ['shirt', 'tee'] },
  { type: 'pants', phrases: ['pants', 'trousers', 'jeans'] },
]

type KnownModel = {
  patterns: RegExp[]
  brand: string
  model: string
  productType: string
  aliases: string[]
}

const KNOWN_MODELS: KnownModel[] = [
  {
    patterns: [/\bps5\b/i, /\bplaystation\s*5\b/i],
    brand: 'Sony',
    model: 'PlayStation 5',
    productType: 'game console',
    aliases: ['ps5', 'playstation 5'],
  },
  {
    patterns: [/\bxbox\s+series\s+x\b/i],
    brand: 'Microsoft',
    model: 'Xbox Series X',
    productType: 'game console',
    aliases: ['xbox series x', 'series x'],
  },
  {
    patterns: [/\bxbox\s+series\s+s\b/i],
    brand: 'Microsoft',
    model: 'Xbox Series S',
    productType: 'game console',
    aliases: ['xbox series s', 'series s'],
  },
  {
    patterns: [/\bnintendo\s+switch\b/i],
    brand: 'Nintendo',
    model: 'Nintendo Switch',
    productType: 'game console',
    aliases: ['nintendo switch', 'switch console'],
  },
  {
    patterns: [/\bairpods\s+pro\b/i],
    brand: 'Apple',
    model: 'AirPods Pro',
    productType: 'earbuds',
    aliases: ['airpods pro'],
  },
  {
    patterns: [/\bairpods\s+max\b/i],
    brand: 'Apple',
    model: 'AirPods Max',
    productType: 'headphones',
    aliases: ['airpods max'],
  },
  {
    patterns: [/\bwh[-\s]?1000xm5\b/i],
    brand: 'Sony',
    model: 'WH-1000XM5',
    productType: 'headphones',
    aliases: ['wh-1000xm5', 'wh 1000xm5', 'wh1000xm5'],
  },
]

const BRANDS = [
  'adidas',
  'apple',
  'blundstone',
  'bose',
  'dell',
  'google',
  'hp',
  'lenovo',
  'lg',
  'microsoft',
  'new balance',
  'nike',
  'nintendo',
  'samsung',
  'sony',
]

const MATERIALS = new Set([
  'canvas',
  'cashmere',
  'cotton',
  'denim',
  'fleece',
  'leather',
  'linen',
  'silk',
  'suede',
  'velvet',
  'wool',
])

const PREFERENCE_WORDS = new Set([
  'compact',
  'ergonomic',
  'lightweight',
  'noise cancelling',
  'portable',
  'quiet',
  'waterproof',
  'wireless',
  'wide toe box',
])

// Product subtypes expressed in the query are hard intent, not diversity
// facets. Their aliases let normal retailer vocabulary satisfy the constraint
// (for example, an "executive desk chair" can satisfy "office chair").
const PRODUCT_SUBTYPE_ALIASES: Record<string, string[]> = {
  'ankle': ['ankle', 'chelsea'],
  'chelsea': ['chelsea', 'elastic sided', 'pull on'],
  'gaming': ['gaming', 'gamer'],
  'hiking': ['hiking', 'trekking', 'trail'],
  'mechanical': ['mechanical'],
  'office': [
    'office', 'desk chair', 'task chair', 'managerial', 'executive',
    'computer chair', 'computer desk', 'workstation',
  ],
  'over-ear': ['over ear', 'over-ear', 'circumaural'],
  'running': ['running', 'road running', 'trail running'],
  'standing': ['standing', 'sit stand', 'sit-stand', 'height adjustable'],
  'walking': ['walking'],
  'work': ['work', 'workwear', 'safety toe', 'steel toe'],
}

const PRODUCT_SUBTYPE_TYPES: Partial<Record<string, Set<string>>> = {
  ankle: new Set(['boots', 'shoes']),
  chelsea: new Set(['boots', 'shoes']),
  hiking: new Set(['boots', 'shoes']),
  mechanical: new Set(['keyboard']),
  office: new Set(['chair', 'desk']),
  'over-ear': new Set(['headphones']),
  running: new Set(['shoes', 'watch']),
  standing: new Set(['desk']),
  walking: new Set(['shoes']),
  work: new Set(['boots', 'shoes']),
}

const DEMANDED_ATTRIBUTE_ALIASES: Record<string, string[]> = {
  '2nd generation': ['2nd generation', 'second generation', 'generation 2', 'gen 2'],
  'dual monitor': ['dual monitor', 'dual monitors', 'dual display', 'dual displays', 'two monitors', 'two displays'],
  'gps': ['gps', 'garmin forerunner', 'suunto race'],
  'noise cancelling': ['noise cancelling', 'noise canceling', 'active noise cancellation', 'anc'],
  'quiet': ['quiet', 'silent', 'low noise', 'low-noise', 'noise reduced'],
  'usb-c': ['usb c', 'usb-c', 'type c', 'type-c'],
  'vegan leather': ['vegan leather', 'faux leather', 'synthetic leather', 'plant leather', 'pu leather', 'polyurethane leather'],
}

const QUERY_FILLER = new Set([
  'a',
  'an',
  'and',
  'best',
  'buy',
  'cheap',
  'expensive',
  'find',
  'for',
  'good',
  'i',
  'looking',
  'me',
  'my',
  'need',
  'or',
  'please',
  'the',
  'to',
  'want',
  'with',
])

const DEVICE_ALIASES: Array<{ canonical: string; patterns: RegExp[] }> = [
  { canonical: 'PlayStation 5', patterns: [/\bps5\b/i, /\bplaystation\s*5\b/i] },
  { canonical: 'Xbox Series X', patterns: [/\bxbox\s+series\s+x\b/i] },
  { canonical: 'Xbox Series S', patterns: [/\bxbox\s+series\s+s\b/i] },
  { canonical: 'Nintendo Switch', patterns: [/\bnintendo\s+switch\b/i] },
  { canonical: 'iPhone', patterns: [/\biphone(?:\s+\d+(?:\s+pro(?:\s+max)?)?)?\b/i] },
  { canonical: 'Android', patterns: [/\bandroid\b/i] },
  { canonical: 'MacBook', patterns: [/\bmacbook(?:\s+(?:air|pro))?\b/i] },
]

const ACCESSORY_TERMS: Record<string, string[]> = {
  'game console': [
    'controller', 'gamepad', 'game', 'disc', 'headset', 'stand', 'skin', 'case',
    'cover', 'cooling fan', 'charger', 'charging station', 'cable', 'replacement',
    'storage expansion', 'ssd', 'faceplate', 'wall mount',
  ],
  monitor: ['monitor arm', 'monitor stand', 'mount', 'riser', 'screen protector', 'cable', 'adapter'],
  phone: ['case', 'cover', 'screen protector', 'charger', 'cable', 'mount', 'stand', 'battery pack'],
  laptop: ['sleeve', 'bag', 'case', 'charger', 'dock', 'stand', 'screen protector', 'keyboard cover'],
  boots: [
    'laces', 'insole', 'insoles', 'polish', 'cleaner', 'care kit', 'shoe care',
    'renovating cream', 'waterproof spray', 'buffing cloth', 'shoe tree', 'boot trees',
  ],
  shoes: [
    'laces', 'insole', 'insoles', 'polish', 'cleaner', 'care kit', 'shoe care',
    'renovating cream', 'waterproof spray', 'buffing cloth', 'shoe tree',
  ],
  chair: [
    'chair mat', 'chair cover', 'seat cushion', 'caster', 'casters', 'wheels',
    'armrest', 'replacement parts', 'carry bag', 'storage bag',
  ],
  controller: [
    'controller case', 'thumb grip', 'thumb grips', 'grip cap', 'grip caps',
    'precision ring', 'precision rings', 'charging station', 'charging stand',
    'controller charger', 'cooling station', 'replacement joystick',
  ],
  backpack: ['rain cover', 'replacement strap', 'straps', 'organizer insert'],
  'tote bag': ['bag organizer', 'organizer insert', 'tote insert'],
  watch: ['watch band', 'watch strap', 'charger', 'charging cable', 'screen protector', 'case'],
  headphones: ['case', 'earpads', 'ear pads', 'cable', 'stand', 'adapter'],
  earbuds: ['case', 'ear tips', 'earhooks', 'charging case', 'replacement buds'],
}

const PRODUCT_FAMILIES: Record<string, string> = {
  boots: 'footwear',
  shoes: 'footwear',
  earbuds: 'personal audio',
  headphones: 'personal audio',
}

const FALSE_MATERIAL_MODIFIERS = ['faux', 'vegan', 'synthetic', 'imitation', 'artificial']

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const hay = ` ${normalize(haystack)} `
  const needle = ` ${normalize(phrase)} `
  if (hay.includes(needle)) return true
  if (needle.endsWith('s ') && hay.includes(`${needle.slice(0, -2)} `)) return true
  return false
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))]
}

function inferProductType(value: string): string | undefined {
  const normalized = normalize(value)

  // Prefer the first explicit product noun in the title. This keeps
  // "controller for PS5 console" classified as a controller, while allowing
  // a legitimate "Xbox ... Gaming Console - Includes Wireless Controller"
  // bundle to remain a console. Definition order breaks ties in favor of
  // specific compound nouns such as "monitor stand" over "monitor".
  const padded = ` ${normalized} `
  let earliest: { type: string; index: number } | undefined
  for (const definition of PRODUCT_DEFINITIONS) {
    for (const phrase of definition.phrases) {
      const needle = ` ${normalize(phrase)} `
      let index = padded.indexOf(needle)
      if (index < 0 && needle.endsWith('s ')) {
        index = padded.indexOf(`${needle.slice(0, -2)} `)
      }
      if (index >= 0 && (!earliest || index < earliest.index)) {
        earliest = { type: definition.type, index }
      }
    }
  }
  if (earliest) return earliest.type

  const model = KNOWN_MODELS.find((known) => known.patterns.some((pattern) => pattern.test(value)))
  if (model) return model.productType
  return undefined
}

function findKnownModel(value: string): KnownModel | undefined {
  return KNOWN_MODELS.find((known) => known.patterns.some((pattern) => pattern.test(value)))
}

function findBrand(value: string): string | undefined {
  const found = BRANDS.find((brand) => includesPhrase(value, brand))
  return found ? found.replace(/\b\w/g, (character) => character.toUpperCase()) : undefined
}

function genericModel(value: string, brand?: string): string | undefined {
  const known = findKnownModel(value)
  if (known) return known.model

  const hyphenated = value.match(
    /\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+\b/i,
  )?.[0]
  if (hyphenated) return hyphenated.toUpperCase()

  const normalized = normalize(value)
  const tokens = normalized.split(' ')
  const alphaNumeric = tokens.find(
    (token) =>
      /[a-z]/.test(token) && /\d/.test(token) &&
      !/^\d+(?:gb|tb|hz|inch|in)$/.test(token) && token.length >= 3,
  )
  if (alphaNumeric) return alphaNumeric.toUpperCase()

  if (brand) {
    const brandIndex = tokens.findIndex((token) => token === normalize(brand))
    const numeric = brandIndex >= 0 ? tokens[brandIndex + 1] : undefined
    if (numeric && /^\d{2,4}$/.test(numeric)) return numeric
  }
  return undefined
}

function modelAliases(model: string): string[] {
  const known = KNOWN_MODELS.find((candidate) => candidate.model.toLowerCase() === model.toLowerCase())
  return known?.aliases ?? [model]
}

function stripFilterLanguage(query: string): string {
  return query
    .replace(
      /\b(?:between\s+\$?\s*\d+(?:\.\d{1,2})?\s+(?:and|to|-)\s+\$?\s*\d+(?:\.\d{1,2})?|(?:under|below|less than|at most|up to|cheaper than|no more than|above|over|more than|at least|starting at|minimum|min)\s*\$?\s*\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd|bucks?)?/gi,
      ' ',
    )
    .replace(/\b(?:new|brand new|used|pre-owned|preowned|refurbished|renewed|open box)\b/gi, ' ')
    .replace(/\b(?:but\s+not|not|without|exclude|excluding|no)\s+[a-z0-9-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function correctKnownTypos(query: string): string {
  return query
    .replace(/\bwireles\b/gi, 'wireless')
    .replace(/\bheadph(?:nes|ons)\b/gi, 'headphones')
}

function parseCondition(query: string): ProductCondition {
  if (/\b(?:open[- ]box)\b/i.test(query)) return 'open-box'
  if (/\b(?:refurbished|renewed|remanufactured)\b/i.test(query)) return 'refurbished'
  if (/\b(?:used|pre[- ]?owned|second[- ]hand)\b/i.test(query)) return 'used'
  if (/\b(?:brand[- ]new|new condition|new only)\b/i.test(query)) return 'new'
  return 'any'
}

function parseNegations(query: string): string[] {
  const values: string[] = []
  const pattern = /\b(?:but\s+not|not|without|exclude|excluding|no)\s+([a-z0-9-]+(?:\s+[a-z0-9-]+)?)/gi
  for (const match of query.matchAll(pattern)) {
    const phrase = match[1]
      .replace(/\b(?:and|or|with|under|over|above|below|for)\b.*$/i, '')
      .trim()
    // Conversational uncertainty ("not sure what style") is not a product
    // exclusion. Treating it as must-not data creates nonsense filters.
    if (/^(?:sure|certain)\b/i.test(phrase)) continue
    if (phrase) values.push(phrase)
  }
  return unique(values)
}

function parseCompatibility(query: string, productType?: string): string[] {
  const explicit = /\b(?:compatible with|works with|made for|for)\s+(.+)$/i.exec(query)?.[1] ?? ''
  if (!explicit) return []
  return DEVICE_ALIASES.filter((device) =>
    device.patterns.some((pattern) => pattern.test(explicit)),
  )
    .filter((device) => {
      // "PS5 console" is the product itself. "controller for PS5" expresses
      // compatibility and needs a platform gate.
      return productType !== 'game console' || !device.patterns.some((pattern) => pattern.test(query))
    })
    .map((device) => device.canonical)
}

function demandedAttributes(query: string, productType?: string): string[] {
  const normalized = normalize(query)
  const veganLeather = includesPhrase(normalized, 'vegan leather')
  return unique([
    ...[...MATERIALS].filter(
      (material) => includesPhrase(normalized, material) && !(material === 'leather' && veganLeather),
    ),
    ...[...PREFERENCE_WORDS].filter((preference) => includesPhrase(normalized, preference)),
    ...Object.entries(PRODUCT_SUBTYPE_ALIASES)
      .filter(([subtype, aliases]) => {
        if (!aliases.some((alias) => includesPhrase(normalized, alias))) return false
        const types = PRODUCT_SUBTYPE_TYPES[subtype]
        return !types || !productType || types.has(productType)
      })
      .map(([subtype]) => subtype),
    ...(veganLeather ? ['vegan leather'] : []),
    ...(/\b(?:2nd|second)\s+generation\b|\bgen(?:eration)?\s*2\b/i.test(query) ? ['2nd generation'] : []),
    ...(includesPhrase(normalized, 'usb c') ? ['usb-c'] : []),
    ...(includesPhrase(normalized, 'dual monitor') || includesPhrase(normalized, 'dual monitors') ||
      includesPhrase(normalized, 'dual display') || includesPhrase(normalized, 'dual displays')
      ? ['dual monitor']
      : []),
    ...(includesPhrase(normalized, 'gps') ? ['gps'] : []),
    ...(/\bnoise canc(?:elling|eling|ellation)\b/i.test(query) ? ['noise cancelling'] : []),
  ])
}

function optionalKeywords(
  query: string,
  productType: string | undefined,
  brand: string | undefined,
  model: string | undefined,
  must: string[],
  mustNot: string[],
): string[] {
  const ignored = new Set([
    ...QUERY_FILLER,
    ...normalize(productType ?? '').split(' '),
    ...normalize(brand ?? '').split(' '),
    ...normalize(model ?? '').split(' '),
    ...must.flatMap((value) => normalize(value).split(' ')),
    ...mustNot.flatMap((value) => normalize(value).split(' ')),
  ])
  return unique(
    normalize(stripFilterLanguage(query))
      .split(' ')
      .filter((token) => token.length >= 3 && !ignored.has(token) && !/^\d+$/.test(token)),
  )
}

function targetFromQuery(query: string): SearchTarget {
  // A device after "for" is compatibility, not the product being bought:
  // "controller for PS5" must not become model=PlayStation 5.
  const productPhrase = query.replace(/\b(?:compatible with|works with|made for|for)\s+.+$/i, '').trim() || query
  const known = findKnownModel(productPhrase)
  const productType = inferProductType(productPhrase) ?? known?.productType
  const brand = known?.brand ?? findBrand(productPhrase)
  const model = known?.model ?? genericModel(productPhrase, brand)
  return { query: stripFilterLanguage(query), productType, brand, model }
}

function missionKind(query: string): boolean {
  return /\b(?:furnish|equip|stock|assemble|complete setup|starter (?:kit|set)|build (?:me )?(?:a |an )?.*(?:setup|kit|office|room|studio|gym|wardrobe)|gift (?:for|ideas?)|outfit for|essentials for|everything (?:i|we) need)\b/i.test(query)
}

/** Build a reliable structured interpretation without a network or LLM call. */
export function buildSearchSpec(rawQuery: string): SearchSpec {
  const raw = rawQuery.trim().slice(0, 500)
  const corrected = correctKnownTypos(raw)
  const explicitProducts = explicitProductList(corrected)
  const kind: SearchKind = explicitProducts.length >= 2
    ? 'list'
    : missionKind(corrected)
      ? 'mission'
      : 'product'
  const targetQueries = explicitProducts.length >= 2 ? explicitProducts : [corrected]
  const targets = targetQueries.map(targetFromQuery)
  const primary = targets.length === 1 ? targets[0] : undefined
  const mustNot = parseNegations(corrected)
  const attributes = demandedAttributes(corrected, primary?.productType).filter(
    (attribute) => !mustNot.some((excluded) => includesPhrase(excluded, attribute)),
  )
  const bounds = parsePriceBounds(raw)
  const condition = parseCondition(corrected)
  const compatibility = parseCompatibility(corrected, primary?.productType)
  const should = optionalKeywords(
    corrected,
    primary?.productType,
    primary?.brand,
    primary?.model,
    attributes,
    mustNot,
  )

  return {
    rawQuery: raw,
    refinedQuery: stripFilterLanguage(corrected),
    kind,
    targets,
    productType: primary?.productType,
    brand: primary?.brand,
    model: primary?.model,
    must: attributes,
    should,
    mustNot,
    compatibility,
    condition,
    minPriceMinor: bounds.minPriceMinor,
    maxPriceMinor: bounds.maxPriceMinor,
    confidence: explicitProducts.length >= 2 || primary?.productType ? 0.95 : missionKind(corrected) ? 0.9 : 0.65,
  }
}

function withoutFalseMaterial(haystack: string, material: string, demanded: string[]): string {
  const modifiers = FALSE_MATERIAL_MODIFIERS.filter(
    (modifier) => !demanded.some((value) => includesPhrase(value, `${modifier} ${material}`)),
  )
  let value = normalize(haystack)
  for (const modifier of modifiers) {
    value = value.replace(new RegExp(`\\b${modifier}\\s+${material}\\b`, 'g'), ' ')
  }
  return value
    .replace(new RegExp(`\\b${material}\\s+(?:free|alternative|like|substitute)\\b`, 'g'), ' ')
    .replace(new RegExp(`\\b(?:no|not|without|non)\\s+${material}\\b`, 'g'), ' ')
}

function requestedAttributePresent(haystack: string, attribute: string, must: string[]): boolean {
  const demandedAliases = DEMANDED_ATTRIBUTE_ALIASES[attribute]
  if (demandedAliases) {
    return demandedAliases.some((alias) => includesPhrase(haystack, alias))
  }
  if (MATERIALS.has(attribute)) {
    return includesPhrase(withoutFalseMaterial(haystack, attribute, must), attribute)
  }
  const aliases = PRODUCT_SUBTYPE_ALIASES[attribute]
  if (aliases) return aliases.some((alias) => includesPhrase(haystack, alias))
  return includesPhrase(haystack, attribute)
}

function listingCondition(haystack: string): ProductCondition | undefined {
  if (/\bopen[- ]box\b/i.test(haystack)) return 'open-box'
  if (/\b(?:refurbished|renewed|remanufactured)\b/i.test(haystack)) return 'refurbished'
  if (/\b(?:used|pre[- ]?owned|second[- ]hand)\b/i.test(haystack)) return 'used'
  if (/\b(?:brand[- ]new|new condition|factory sealed)\b/i.test(haystack)) return 'new'
  return undefined
}

function compatibilityConflict(requested: string[], haystack: string): boolean {
  if (requested.length === 0) return false
  const requestedDevices = new Set(requested)
  const mentioned = DEVICE_ALIASES.filter((device) =>
    device.patterns.some((pattern) => pattern.test(haystack)),
  ).map((device) => device.canonical)
  return mentioned.length > 0 && mentioned.every((device) => !requestedDevices.has(device))
}

function hasAccessorySignal(productType: string, haystack: string): boolean {
  return (ACCESSORY_TERMS[productType] ?? []).some((term) => includesPhrase(haystack, term))
}

function hasMainProductEvidence(productType: string, title: string): boolean {
  if (
    (productType === 'boots' || productType === 'shoes') &&
    /\b(?:care\s+kit|shoe\s+care|boot\s+care|renovating\s+cream|waterproof\s+spray|buffing\s+cloth|shoe\s+tree|boot\s+trees?)\b/i.test(
      title,
    )
  ) {
    return false
  }
  if (productType === 'chair') {
    if (
      /\b(?:chair\s+(?:carry|storage)\s+bag|(?:carry|storage)\s+bag\s+(?:for\s+)?(?:camp\s+)?chairs?|chair\s+(?:cover|parts?|casters?|wheels?))\b/i.test(
        title,
      )
    ) {
      return false
    }
    return includesPhrase(title, productType)
  }
  if (productType === 'controller') {
    if (hasAccessorySignal(productType, title)) return false
    return includesPhrase(title, 'controller') || includesPhrase(title, 'gamepad')
  }
  if (productType === 'earbuds') {
    if (
      /^\s*(?:case\s+)?for\s+airpods\b/i.test(title) ||
      /\b(?:replacement\s+)?(?:charging\s+)?case\s+(?:only|for|compatible)\b/i.test(title) ||
      /\b(?:charging\s+)?case\s+replacement\b/i.test(title) ||
      /\b(?:ear\s*tips?|earhooks?)\s+(?:for|compatible)\b/i.test(title)
    ) {
      return false
    }
    return /\b(?:airpods|earbuds?|earphones?)\b/i.test(title)
  }
  if (productType !== 'game console') return includesPhrase(title, productType)
  if (/\b(?:disc|optical)\s+drive\b/i.test(title)) return false
  if (/\bconsole\s+(?:cover|case|stand|mount|skin|faceplate|fan|charger|cable)\b/i.test(title)) {
    return false
  }
  return /\b(?:console|digital edition|disc edition|825\s*gb|1\s*tb)\b/i.test(title)
}

function isSameProductFamily(requested: string, actual: string): boolean {
  return requested === actual || (
    PRODUCT_FAMILIES[requested] !== undefined && PRODUCT_FAMILIES[requested] === PRODUCT_FAMILIES[actual]
  )
}

/**
 * Classify a candidate before score-based ranking. Complement and irrelevant
 * results are deliberately ineligible for the main result rail.
 */
export function classifyProductRole(
  spec: SearchSpec,
  listing: NormalizedListing,
): ProductRoleDecision {
  const reasons: string[] = []
  const haystack = `${listing.title} ${listing.detailsText ?? ''}`

  if (
    listing.priceMinor <= 0 &&
    (spec.minPriceMinor !== undefined || spec.maxPriceMinor !== undefined)
  ) {
    return {
      role: 'irrelevant',
      eligible: false,
      confidence: 1,
      reasons: ['price is required to verify the requested budget'],
    }
  }
  if (spec.minPriceMinor !== undefined && listing.priceMinor > 0 && listing.priceMinor < spec.minPriceMinor) {
    return { role: 'irrelevant', eligible: false, confidence: 1, reasons: ['below minimum price'] }
  }
  if (spec.maxPriceMinor !== undefined && listing.priceMinor > 0 && listing.priceMinor > spec.maxPriceMinor) {
    return { role: 'irrelevant', eligible: false, confidence: 1, reasons: ['above maximum price'] }
  }
  const excluded = spec.mustNot.find((value) => includesPhrase(haystack, value))
  if (excluded) {
    return { role: 'irrelevant', eligible: false, confidence: 1, reasons: [`excluded attribute: ${excluded}`] }
  }
  const missing = spec.must.find((value) => !requestedAttributePresent(haystack, value, spec.must))
  if (missing) {
    return { role: 'irrelevant', eligible: false, confidence: 0.98, reasons: [`missing required attribute: ${missing}`] }
  }
  const actualCondition = listingCondition(haystack)
  if (spec.condition === 'new' && actualCondition && actualCondition !== 'new') {
    return { role: 'irrelevant', eligible: false, confidence: 1, reasons: [`condition is ${actualCondition}`] }
  }
  if (spec.condition !== 'any' && spec.condition !== 'new' && actualCondition !== spec.condition) {
    return { role: 'irrelevant', eligible: false, confidence: 0.98, reasons: [`condition is not ${spec.condition}`] }
  }
  if (compatibilityConflict(spec.compatibility, haystack)) {
    return { role: 'irrelevant', eligible: false, confidence: 0.98, reasons: ['incompatible platform'] }
  }
  if (
    spec.compatibility.length > 0 &&
    !DEVICE_ALIASES.some(
      (device) => spec.compatibility.includes(device.canonical) &&
        device.patterns.some((pattern) => pattern.test(haystack)),
    )
  ) {
    return { role: 'irrelevant', eligible: false, confidence: 0.95, reasons: ['compatibility not evidenced'] }
  }

  // A list/mission is split into target searches before product-role gating.
  // If a caller passes the unsplit spec, use the best matching target.
  const target = spec.targets.length === 1
    ? spec.targets[0]
    : spec.targets.find((candidate) => {
        const aliases = candidate.model ? modelAliases(candidate.model) : [candidate.query]
        return aliases.some((alias) => includesPhrase(haystack, alias))
      })
  if (!target?.productType) {
    const queryMatch = includesPhrase(haystack, target?.query ?? spec.refinedQuery)
    return queryMatch
      ? { role: 'exact', eligible: true, confidence: 0.75, reasons: ['query phrase matched'] }
      : { role: 'irrelevant', eligible: false, confidence: 0.65, reasons: ['unknown product type and no phrase match'] }
  }

  const actualType = inferProductType(haystack)
  if (
    target.productType === 'game console' &&
    /(?:\(\s*(?:ps5|xbox(?:\s+series\s+[xs])?)\s*\)|\bfor\s+(?:ps5|playstation\s*5|xbox(?:\s+series\s+[xs])?)\b)/i.test(listing.title) &&
    !/\b(?:console|digital edition|disc edition|slim console|825\s*gb|1\s*tb console)\b/i.test(listing.title)
  ) {
    return {
      role: 'complement',
      eligible: false,
      confidence: 0.97,
      reasons: ['platform label describes compatibility, not console hardware'],
    }
  }
  if (
    target.productType === 'game console' &&
    !hasMainProductEvidence(target.productType, listing.title)
  ) {
    return {
      role: 'complement',
      eligible: false,
      confidence: 0.96,
      reasons: ['console platform mentioned without console hardware evidence'],
    }
  }
  if (
    hasAccessorySignal(target.productType, haystack) &&
    (actualType !== target.productType || !hasMainProductEvidence(target.productType, listing.title))
  ) {
    return {
      role: 'complement',
      eligible: false,
      confidence: 0.98,
      reasons: [`accessory for ${target.productType}`],
    }
  }
  if (actualType && !isSameProductFamily(target.productType, actualType)) {
    const mentionsRequestedProduct = target.model
      ? modelAliases(target.model).some((alias) => includesPhrase(haystack, alias))
      : includesPhrase(haystack, target.productType)
    if (mentionsRequestedProduct && hasAccessorySignal(target.productType, haystack)) {
      return {
        role: 'complement',
        eligible: false,
        confidence: 0.98,
        reasons: [`${actualType} is complementary to ${target.productType}`],
      }
    }
    return {
      role: 'irrelevant',
      eligible: false,
      confidence: 0.95,
      reasons: [`product type is ${actualType}, not ${target.productType}`],
    }
  }
  if (!actualType && hasAccessorySignal(target.productType, haystack)) {
    return {
      role: 'complement',
      eligible: false,
      confidence: 0.9,
      reasons: [`accessory for ${target.productType}`],
    }
  }
  if (!actualType) {
    return { role: 'irrelevant', eligible: false, confidence: 0.7, reasons: ['product type not evidenced'] }
  }

  const modelMatches = !target.model || modelAliases(target.model).some((alias) => includesPhrase(haystack, alias))
  const knownModelImpliesBrand = Boolean(
    target.model &&
      modelMatches &&
      KNOWN_MODELS.some(
        (known) => known.model.toLowerCase() === target.model?.toLowerCase(),
      ),
  )
  const brandMatches =
    !target.brand || includesPhrase(haystack, target.brand) || knownModelImpliesBrand
  if (brandMatches && modelMatches && actualType === target.productType) {
    reasons.push('requested product type matched')
    if (target.brand) reasons.push('brand matched')
    if (target.model) reasons.push('model matched')
    return { role: 'exact', eligible: true, confidence: 0.98, reasons }
  }

  if (target.brand && !brandMatches) {
    return {
      role: 'substitute',
      eligible: false,
      confidence: 0.96,
      reasons: ['different brand'],
    }
  }
  reasons.push(target.model && !modelMatches ? 'different model' : 'same product family')
  return { role: 'substitute', eligible: true, confidence: 0.88, reasons }
}

export function classifyListingsByRole(
  spec: SearchSpec,
  listings: NormalizedListing[],
): ClassifiedListing[] {
  return listings.map((listing) => ({ listing, decision: classifyProductRole(spec, listing) }))
}

export function filterEligibleListings(
  spec: SearchSpec,
  listings: NormalizedListing[],
  options: { allowSubstitutes?: boolean; allowComplements?: boolean } = {},
): NormalizedListing[] {
  const allowSubstitutes = options.allowSubstitutes ?? true
  const allowComplements = options.allowComplements ?? false
  return classifyListingsByRole(spec, listings)
    .filter(({ decision }) =>
      decision.role === 'exact' ||
      (allowSubstitutes && decision.role === 'substitute') ||
      (allowComplements && decision.role === 'complement'),
    )
    .map(({ listing }) => listing)
}
