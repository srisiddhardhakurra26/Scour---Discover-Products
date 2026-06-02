'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'

// SavedProduct has no unique constraint on productId, so guard against
// duplicates explicitly and operate on all matching rows when removing/updating.

export async function saveProduct(productId: string) {
  const existing = await prisma.savedProduct.findFirst({ where: { productId } })
  if (!existing) {
    await prisma.savedProduct.create({ data: { productId } })
  }
  revalidatePath('/wishlist')
}

export async function unsaveProduct(productId: string) {
  await prisma.savedProduct.deleteMany({ where: { productId } })
  revalidatePath('/wishlist')
}

// Set or clear a price-drop target (in minor units). There is no background
// job watching this — it's surfaced as a "target hit" highlight whenever the
// wishlist is viewed and the current lowest price is at/below the threshold.
export async function setAlert(productId: string, alertBelowMinor: number | null) {
  await prisma.savedProduct.updateMany({
    where: { productId },
    data: { alertBelowMinor },
  })
  revalidatePath('/wishlist')
}
