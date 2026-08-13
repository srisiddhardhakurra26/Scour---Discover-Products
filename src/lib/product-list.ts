const COMPOUND_CATEGORIES: Array<[phrase: string, label: string]> = [
  ['computer monitor', 'monitor'],
  ['monitor arm', 'monitor arm'],
  ['monitor stand', 'monitor stand'],
  ['laptop backpack', 'laptop backpack'],
  ['laptop bag', 'laptop bag'],
  ['camera backpack', 'camera backpack'],
  ['camera bag', 'camera bag'],
  ['chair mat', 'chair mat'],
  ['desk chair', 'desk chair'],
  ['office chair', 'office chair'],
  ['gaming chair', 'gaming chair'],
  ['rocking chair', 'rocking chair'],
  ['dining chair', 'dining chair'],
  ['office desk', 'office desk'],
  ['standing desk', 'standing desk'],
  ['coffee table', 'coffee table'],
  ['side table', 'side table'],
  ['task lamp', 'task lamp'],
  ['desk lamp', 'desk lamp'],
  ['floor lamp', 'floor lamp'],
  ['mechanical keyboard', 'mechanical keyboard'],
  ['gaming keyboard', 'gaming keyboard'],
  ['running shoes', 'running shoes'],
  ['running shoe', 'running shoes'],
  ['hiking boots', 'hiking boots'],
  ['hiking boot', 'hiking boots'],
  ['coffee maker', 'coffee maker'],
  ['coffee grinder', 'coffee grinder'],
  ['water bottle', 'water bottle'],
  ['phone case', 'phone case'],
  ['watch band', 'watch band'],
  ['sound bar', 'sound bar'],
  ['game console', 'game console'],
  ['graphics card', 'graphics card'],
  ['hard drive', 'hard drive'],
  ['power bank', 'power bank'],
  ['air fryer', 'air fryer'],
  ['vacuum cleaner', 'vacuum cleaner'],
  ['bed frame', 'bed frame'],
  ['cutting board', 'cutting board'],
  ['cookware set', 'cookware set'],
  ['tool kit', 'tool kit'],
]

const CATEGORY_ALIASES: Record<string, string> = {
  backpacks: 'backpack', backpack: 'backpack',
  bags: 'bag', bag: 'bag',
  beds: 'bed', bed: 'bed',
  bikes: 'bike', bike: 'bike', bicycles: 'bicycle', bicycle: 'bicycle',
  blenders: 'blender', blender: 'blender',
  boots: 'boots', boot: 'boots',
  cameras: 'camera', camera: 'camera',
  chairs: 'chair', chair: 'chair',
  consoles: 'console', console: 'console',
  couches: 'couch', couch: 'couch', sofas: 'sofa', sofa: 'sofa',
  desks: 'desk', desk: 'desk',
  dresses: 'dress', dress: 'dress',
  earbuds: 'earbuds', earbud: 'earbuds',
  fans: 'fan', fan: 'fan',
  headphones: 'headphones', headphone: 'headphones',
  jackets: 'jacket', jacket: 'jacket',
  keyboards: 'keyboard', keyboard: 'keyboard',
  kettles: 'kettle', kettle: 'kettle',
  lamps: 'lamp', lamp: 'lamp',
  laptops: 'laptop', laptop: 'laptop',
  mattresses: 'mattress', mattress: 'mattress',
  monitors: 'monitor', monitor: 'monitor',
  mice: 'mouse', mouse: 'mouse',
  mugs: 'mug', mug: 'mug',
  pants: 'pants', trousers: 'pants',
  phones: 'phone', phone: 'phone',
  printers: 'printer', printer: 'printer',
  projectors: 'projector', projector: 'projector',
  refrigerators: 'refrigerator', refrigerator: 'refrigerator', fridges: 'refrigerator', fridge: 'refrigerator',
  rugs: 'rug', rug: 'rug',
  shirts: 'shirt', shirt: 'shirt',
  shoes: 'shoes', shoe: 'shoes',
  speakers: 'speaker', speaker: 'speaker',
  stools: 'stool', stool: 'stool',
  tables: 'table', table: 'table',
  tablets: 'tablet', tablet: 'tablet',
  televisions: 'tv', television: 'tv', tvs: 'tv', tv: 'tv',
  toasters: 'toaster', toaster: 'toaster',
  treadmills: 'treadmill', treadmill: 'treadmill',
  tripods: 'tripod', tripod: 'tripod',
  watches: 'watch', watch: 'watch',
}

const IGNORED_WORDS = new Set([
  'a', 'an', 'and', 'best', 'black', 'blue', 'budget', 'buy', 'cheap', 'compact',
  'expensive', 'for', 'good', 'green', 'i', 'large', 'leather', 'looking', 'me',
  'my', 'need', 'new', 'of', 'or', 'portable', 'premium', 'quiet', 'red', 'small',
  'the', 'to', 'used', 'want', 'white', 'wireless', 'with',
])

function cleanTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/\b(?:under|below|less than|at most|up to|over|above|more than|at least)\s*\$?\s*\d+(?:\.\d{1,2})?/g, ' ')
    .match(/[a-z0-9]+/g) ?? []
}

/**
 * Detect a terse shopping list such as "monitor chair backpack". The check
 * is deliberately conservative: known compound products such as "laptop
 * backpack" and "chair mat" remain a single category.
 */
export function explicitProductList(query: string): string[] {
  const tokens = cleanTokens(query)
  if (tokens.length < 2) return []

  const categories: string[] = []
  const covered = new Set<number>()
  const compounds = [...COMPOUND_CATEGORIES].sort(
    (a, b) => b[0].split(' ').length - a[0].split(' ').length,
  )

  for (let index = 0; index < tokens.length; index++) {
    if (covered.has(index)) continue
    const compound = compounds.find(([phrase]) => {
      const parts = phrase.split(' ')
      return parts.every((part, offset) => tokens[index + offset] === part)
    })
    if (!compound) continue
    const parts = compound[0].split(' ')
    parts.forEach((_, offset) => covered.add(index + offset))
    categories.push(compound[1])
  }

  tokens.forEach((token, index) => {
    if (covered.has(index)) return
    const category = CATEGORY_ALIASES[token]
    if (category) {
      covered.add(index)
      categories.push(category)
    }
  })

  const unique = [...new Set(categories)]
  if (unique.length < 2) return []

  const unknown = tokens.filter(
    (token, index) => !covered.has(index) && !IGNORED_WORDS.has(token) && !/^\d+$/.test(token),
  )
  const hasListSeparator = /[,/&+] |[,/&+]|\b(?:and|plus)\b/i.test(query)

  if (hasListSeparator && unknown.length <= 3) return unique
  if (unique.length >= 3 && unknown.length <= 3) return unique
  if (unique.length === 2 && unknown.length === 0) return unique
  return []
}
