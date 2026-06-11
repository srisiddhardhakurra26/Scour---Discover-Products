-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "imageHash" TEXT;
ALTER TABLE "Listing" ADD COLUMN "ocrText" TEXT;

-- CreateTable
CREATE TABLE "SourceHealth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceHealth_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SourceHealth_retailerId_checkedAt_idx" ON "SourceHealth"("retailerId", "checkedAt");

-- CreateIndex
CREATE INDEX "Listing_imageHash_idx" ON "Listing"("imageHash");
