-- CreateTable
CREATE TABLE "Retailer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "label" TEXT,
    "config" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" DATETIME,
    "lastError" TEXT
);

-- CreateTable
CREATE TABLE "Listing" (
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
    "textEmbedding" BLOB,
    "imageEmbedding" BLOB,
    "productId" TEXT,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Listing_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalTitle" TEXT NOT NULL,
    "canonicalImage" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "firstSeenAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "listingCount" INTEGER NOT NULL DEFAULT 0,
    "retailerCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceObservation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "alertBelowMinor" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Retailer_type_identifier_key" ON "Retailer"("type", "identifier");

-- CreateIndex
CREATE INDEX "Listing_productId_idx" ON "Listing"("productId");

-- CreateIndex
CREATE INDEX "Listing_capturedAt_idx" ON "Listing"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_retailerId_externalId_key" ON "Listing"("retailerId", "externalId");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_lastSeenAt_idx" ON "Product"("lastSeenAt");

-- CreateIndex
CREATE INDEX "PriceObservation_listingId_capturedAt_idx" ON "PriceObservation"("listingId", "capturedAt");
