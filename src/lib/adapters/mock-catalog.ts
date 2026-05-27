export type CatalogProduct = { name: string; basePriceCents: number }

export const CATALOG: Record<string, CatalogProduct[]> = {
  cocoa: [
    { name: 'Ghirardelli Premium Baking Cocoa, 8 oz', basePriceCents: 599 },
    { name: "Hershey's Natural Unsweetened Cocoa Powder, 8 oz", basePriceCents: 449 },
    { name: "Anthony's Organic Cacao Powder, 1 lb", basePriceCents: 1299 },
    { name: 'Navitas Organics Cacao Powder, 16 oz', basePriceCents: 1599 },
  ],
  coffee: [
    { name: 'Starbucks Pike Place Roast Ground Coffee, 12 oz', basePriceCents: 999 },
    { name: "Peet's Coffee Major Dickason's Blend Whole Bean, 12 oz", basePriceCents: 1299 },
    { name: 'Lavazza Super Crema Espresso Whole Bean, 2.2 lb', basePriceCents: 2499 },
    { name: 'Death Wish Coffee Whole Bean, 16 oz', basePriceCents: 1995 },
  ],
  earbuds: [
    { name: 'Apple AirPods Pro (2nd Generation) Wireless Earbuds', basePriceCents: 24900 },
    { name: 'Sony WF-1000XM5 Wireless Noise Canceling Earbuds', basePriceCents: 29900 },
    { name: 'Bose QuietComfort Earbuds II', basePriceCents: 27900 },
    { name: 'Samsung Galaxy Buds3 Pro Wireless Earbuds', basePriceCents: 24900 },
  ],
  headphones: [
    { name: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', basePriceCents: 39900 },
    { name: 'Bose QuietComfort 45 Wireless Headphones', basePriceCents: 32900 },
    { name: 'Apple AirPods Max Over-Ear Headphones', basePriceCents: 54900 },
  ],
  hoodie: [
    { name: 'Champion Powerblend Fleece Pullover Hoodie', basePriceCents: 4500 },
    { name: 'Nike Sportswear Club Fleece Pullover Hoodie', basePriceCents: 5500 },
    { name: 'Carhartt Midweight Hooded Sweatshirt', basePriceCents: 6500 },
  ],
  shoe: [
    { name: 'Nike Air Max 90 Mens Running Shoe', basePriceCents: 12000 },
    { name: 'Adidas Stan Smith Originals Shoe', basePriceCents: 10000 },
    { name: 'New Balance 990v6 Made in USA Running Shoe', basePriceCents: 20000 },
  ],
  tv: [
    { name: 'LG C3 65" OLED 4K Smart TV', basePriceCents: 169900 },
    { name: 'Samsung 65" QN90C Neo QLED 4K Smart TV', basePriceCents: 199900 },
    { name: 'TCL 65" QM8 Mini-LED 4K Smart TV', basePriceCents: 99900 },
  ],
  laptop: [
    { name: 'Apple MacBook Air 15" M3, 512GB Laptop', basePriceCents: 149900 },
    { name: 'Dell XPS 15 Laptop, Intel Core i7', basePriceCents: 169900 },
    { name: 'Lenovo ThinkPad X1 Carbon Gen 12 Laptop', basePriceCents: 189900 },
  ],
  book: [
    { name: 'The Pragmatic Programmer, 20th Anniversary Edition Book', basePriceCents: 3499 },
    { name: 'Atomic Habits by James Clear (Book)', basePriceCents: 1499 },
    { name: 'Sapiens: A Brief History of Humankind Book', basePriceCents: 1999 },
  ],
  keyboard: [
    { name: 'Logitech MX Mechanical Wireless Keyboard', basePriceCents: 16900 },
    { name: 'Keychron K2 V2 Wireless Mechanical Keyboard', basePriceCents: 8900 },
    { name: 'Apple Magic Keyboard with Touch ID', basePriceCents: 12900 },
  ],
  mouse: [
    { name: 'Logitech MX Master 3S Wireless Mouse', basePriceCents: 9900 },
    { name: 'Apple Magic Mouse (USB-C)', basePriceCents: 9900 },
    { name: 'Razer DeathAdder V3 Wired Gaming Mouse', basePriceCents: 7000 },
  ],
  monitor: [
    { name: 'LG 27" UltraGear 4K UHD Gaming Monitor', basePriceCents: 49900 },
    { name: 'Dell UltraSharp 27" 4K USB-C Monitor', basePriceCents: 64900 },
    { name: 'Apple Studio Display 27"', basePriceCents: 159900 },
  ],
  backpack: [
    { name: 'Patagonia Black Hole 25L Backpack', basePriceCents: 13900 },
    { name: 'Peak Design Everyday Backpack 30L', basePriceCents: 27000 },
    { name: 'Osprey Daylite Plus Daypack 20L', basePriceCents: 6500 },
  ],
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
}

export function findCatalog(query: string): CatalogProduct[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  for (const [key, items] of Object.entries(CATALOG)) {
    if (tokens.some((t) => t.includes(key) || key.includes(t))) return items
  }
  return []
}
