PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, merchantId TEXT NOT NULL REFERENCES merchants(id),
  email TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, merchantId TEXT NOT NULL REFERENCES merchants(id),
  name TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('model','product','result')),
  width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL,
  filename TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL,
  UNIQUE(id, merchantId)
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, merchantId TEXT NOT NULL REFERENCES merchants(id),
  sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  color TEXT NOT NULL, material TEXT NOT NULL, priceCents INTEGER NOT NULL CHECK(priceCents >= 0),
  stock INTEGER NOT NULL CHECK(stock >= 0), description TEXT NOT NULL,
  imageAssetId TEXT, version INTEGER NOT NULL DEFAULT 1, updatedAt TEXT NOT NULL,
  UNIQUE(merchantId, sku),
  FOREIGN KEY(imageAssetId, merchantId) REFERENCES assets(id, merchantId)
);
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY, merchantId TEXT NOT NULL REFERENCES merchants(id), requestKey TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','interrupted')),
  input TEXT NOT NULL, product TEXT NOT NULL, prompt TEXT NOT NULL,
  resultAssetIds TEXT NOT NULL DEFAULT '[]', error TEXT, debugUrl TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  UNIQUE(merchantId, requestKey)
);
CREATE TABLE IF NOT EXISTS agentRuns (
  id TEXT PRIMARY KEY, merchantId TEXT NOT NULL REFERENCES merchants(id), request TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, merchantId TEXT NOT NULL REFERENCES merchants(id),
  agentRunId TEXT NOT NULL REFERENCES agentRuns(id), data TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, merchantId TEXT NOT NULL REFERENCES merchants(id),
  entityType TEXT NOT NULL, entityId TEXT NOT NULL, kind TEXT NOT NULL,
  payload TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchantId, updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_assets_merchant ON assets(merchantId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_generations_queue ON generations(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_events_merchant ON events(merchantId, id);

CREATE TABLE IF NOT EXISTS productSearchIndex (
  productId TEXT PRIMARY KEY REFERENCES products(id), merchantId TEXT NOT NULL REFERENCES merchants(id),
  version INTEGER NOT NULL, indexedVersion INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','indexed','failed')),
  error TEXT, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_search_pending ON productSearchIndex(status, updatedAt);
CREATE INDEX IF NOT EXISTS idx_product_search_merchant ON productSearchIndex(merchantId, status);

CREATE TRIGGER IF NOT EXISTS product_search_after_insert AFTER INSERT ON products BEGIN
  INSERT INTO productSearchIndex(productId,merchantId,version,status,updatedAt)
    VALUES(NEW.id,NEW.merchantId,NEW.version,'pending',NEW.updatedAt);
END;
CREATE TRIGGER IF NOT EXISTS product_search_after_update AFTER UPDATE ON products BEGIN
  INSERT INTO productSearchIndex(productId,merchantId,version,status,updatedAt)
    VALUES(NEW.id,NEW.merchantId,NEW.version,'pending',NEW.updatedAt)
    ON CONFLICT(productId) DO UPDATE SET version=NEW.version,status='pending',error=NULL,updatedAt=NEW.updatedAt;
END;
INSERT INTO productSearchIndex(productId,merchantId,version,status,updatedAt)
  SELECT id,merchantId,version,'pending',updatedAt FROM products WHERE id NOT IN (SELECT productId FROM productSearchIndex);
