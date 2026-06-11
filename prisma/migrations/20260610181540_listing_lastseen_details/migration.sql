-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Listing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "shippingMinor" INTEGER,
    "availability" TEXT,
    "sellerName" TEXT,
    "sellerRating" REAL,
    "reviewCount" INTEGER,
    "reviewAvg" REAL,
    "raw" TEXT,
    "detailsText" TEXT,
    "textEmbedding" BLOB,
    "imageEmbedding" BLOB,
    "productId" TEXT,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Listing_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Listing" ("availability", "capturedAt", "currency", "externalId", "id", "imageEmbedding", "imageUrl", "priceMinor", "productId", "raw", "retailerId", "reviewAvg", "reviewCount", "sellerName", "sellerRating", "shippingMinor", "textEmbedding", "title", "url") SELECT "availability", "capturedAt", "currency", "externalId", "id", "imageEmbedding", "imageUrl", "priceMinor", "productId", "raw", "retailerId", "reviewAvg", "reviewCount", "sellerName", "sellerRating", "shippingMinor", "textEmbedding", "title", "url" FROM "Listing";
DROP TABLE "Listing";
ALTER TABLE "new_Listing" RENAME TO "Listing";
CREATE INDEX "Listing_productId_idx" ON "Listing"("productId");
CREATE INDEX "Listing_capturedAt_idx" ON "Listing"("capturedAt");
CREATE UNIQUE INDEX "Listing_retailerId_externalId_key" ON "Listing"("retailerId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
