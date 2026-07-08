-- CreateIndex
CREATE INDEX "Listing_retailerId_lastSeenAt_idx" ON "Listing"("retailerId", "lastSeenAt");
