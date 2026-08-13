-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queryHash" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "specJson" TEXT NOT NULL,
    "rankerVersion" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "failedSourceCount" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "diagnosticsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SearchFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "searchRunId" TEXT,
    "queryHash" TEXT NOT NULL,
    "resultKey" TEXT,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchFeedback_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SearchRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SearchRun_createdAt_idx" ON "SearchRun"("createdAt");

-- CreateIndex
CREATE INDEX "SearchRun_intent_createdAt_idx" ON "SearchRun"("intent", "createdAt");

-- CreateIndex
CREATE INDEX "SearchFeedback_searchRunId_idx" ON "SearchFeedback"("searchRunId");

-- CreateIndex
CREATE INDEX "SearchFeedback_createdAt_idx" ON "SearchFeedback"("createdAt");
