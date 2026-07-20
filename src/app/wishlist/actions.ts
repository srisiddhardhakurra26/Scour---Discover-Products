'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'

// SavedProduct has no unique constraint on productId, so guard against
// duplicates explicitly and operate on all matching rows when removing/updating.

function validProductId(productId: string): boolean {
  return productId.length > 0 && productId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(productId)
}

export async function saveProduct(productId: string) {
  if (!validProductId(productId)) throw new Error('Invalid product.')
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (!product) throw new Error('Product not found.')
  const existing = await prisma.savedProduct.findFirst({ where: { productId } })
  if (!existing) {
    await prisma.savedProduct.create({ data: { productId } })
  }
  revalidatePath('/wishlist')
}

export async function unsaveProduct(productId: string) {
  if (!validProductId(productId)) throw new Error('Invalid product.')
  await prisma.savedProduct.deleteMany({ where: { productId } })
  revalidatePath('/wishlist')
}

// Set or clear a price-drop target (in minor units). There is no background
// job watching this — it's surfaced as a "target hit" highlight whenever the
// wishlist is viewed and the current lowest price is at/below the threshold.
export async function setAlert(productId: string, alertBelowMinor: number | null) {
  if (
    !validProductId(productId) ||
    (alertBelowMinor !== null &&
      (!Number.isInteger(alertBelowMinor) || alertBelowMinor < 0 || alertBelowMinor > 100_000_000))
  ) {
    throw new Error('Invalid price alert.')
  }
  await prisma.savedProduct.updateMany({
    where: { productId },
    data: { alertBelowMinor },
  })
  revalidatePath('/wishlist')
}
