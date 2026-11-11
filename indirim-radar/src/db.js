'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace   TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  external_id   TEXT,
  title         TEXT,
  image         TEXT,
  brand         TEXT,
  category      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  source        TEXT,                -- 'manual' | 'watchlist:<id>' | 'demo'
  last_error    TEXT,
  last_checked  INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price        REAL NOT NULL,       -- müşterinin ödediği güncel fiyat
  list_price   REAL,                -- üstü çizili / "önceki" fiyat (satıcının iddiası)
  seller       TEXT,
  in_stock     INTEGER NOT NULL DEFAULT 1,
  captured_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_product_time ON price_snapshots(product_id, captured_at);

CREATE TABLE IF NOT EXISTS watchlists (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace    TEXT NOT NULL,
  url            TEXT NOT NULL UNIQUE,
  label          TEXT,
  max_products   INTEGER NOT NULL DEFAULT 40,
  active         INTEGER NOT NULL DEFAULT 1,
  last_run       INTEGER,
  last_error     TEXT,
  created_at     INTEGER NOT NULL
);
`;

let db;

function open(file = config.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

function close() {
  if (db) db.close();
  db = undefined;
}

const now = () => Date.now();

function upsertProduct(p) {
  const d = open();
  const existing = d.prepare('SELECT * FROM products WHERE url = ?').get(p.url);
  if (existing) {
    d.prepare(
      `UPDATE products SET title = COALESCE(?, title), image = COALESCE(?, image),
       brand = COALESCE(?, brand), category = COALESCE(?, category),
       external_id = COALESCE(?, external_id) WHERE id = ?`
    ).run(p.title ?? null, p.image ?? null, p.brand ?? null, p.category ?? null, p.externalId ?? null, existing.id);
    return existing.id;
  }
  const r = d
    .prepare(
      `INSERT INTO products (marketplace, url, external_id, title, image, brand, category, is_demo, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.marketplace,
      p.url,
      p.externalId ?? null,
      p.title ?? null,
      p.image ?? null,
      p.brand ?? null,
      p.category ?? null,
      p.isDemo ? 1 : 0,
      p.source ?? 'manual',
      p.createdAt ?? now()
    );
  return Number(r.lastInsertRowid);
}

function addSnapshot(productId, s) {
  open()
    .prepare(
      `INSERT INTO price_snapshots (product_id, price, list_price, seller, in_stock, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(productId, s.price, s.listPrice ?? null, s.seller ?? null, s.inStock === false ? 0 : 1, s.capturedAt ?? now());
}

function markChecked(productId, error = null) {
  open().prepare('UPDATE products SET last_checked = ?, last_error = ? WHERE id = ?').run(now(), error, productId);
}

function getProduct(id) {
  return open().prepare('SELECT * FROM products WHERE id = ?').get(id);
}

function listProducts({ activeOnly = false } = {}) {
  return open()
    .prepare(`SELECT * FROM products ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY id`)
    .all();
}

function getSnapshots(productId, sinceMs = 0) {
  return open()
    .prepare(
      `SELECT price, list_price AS listPrice, seller, in_stock AS inStock, captured_at AS capturedAt
       FROM price_snapshots WHERE product_id = ? AND captured_at >= ? ORDER BY captured_at`
    )
    .all(productId, sinceMs);
}

function setProductActive(id, active) {
  open().prepare('UPDATE products SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function deleteProduct(id) {
  open().prepare('DELETE FROM products WHERE id = ?').run(id);
}

function deleteDemo() {
  open().prepare('DELETE FROM products WHERE is_demo = 1').run();
}

function addWatchlist(w) {
  const d = open();
  const ex = d.prepare('SELECT id FROM watchlists WHERE url = ?').get(w.url);
  if (ex) return ex.id;
  const r = d
    .prepare('INSERT INTO watchlists (marketplace, url, label, max_products, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(w.marketplace, w.url, w.label ?? null, w.maxProducts ?? 40, now());
  return Number(r.lastInsertRowid);
}

function listWatchlists() {
  return open().prepare('SELECT * FROM watchlists ORDER BY id').all();
}

function markWatchlistRun(id, error = null) {
  open().prepare('UPDATE watchlists SET last_run = ?, last_error = ? WHERE id = ?').run(now(), error, id);
}

function deleteWatchlist(id) {
  open().prepare('DELETE FROM watchlists WHERE id = ?').run(id);
}

module.exports = {
  open,
  close,
  upsertProduct,
  addSnapshot,
  markChecked,
  getProduct,
  listProducts,
  getSnapshots,
  setProductActive,
  deleteProduct,
  deleteDemo,
  addWatchlist,
  listWatchlists,
  markWatchlistRun,
  deleteWatchlist,
};
