-- Neon PostgreSQL schema for Samten Inventory System
-- Run this once against your Neon database to create all tables.

-- ============================================================
-- SYSTEM CONFIG (key-value settings)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Seed defaults
INSERT INTO system_config (key, value) VALUES
  ('bill_prefix', 'BILL-'),
  ('gst_rate', '0.05'),
  ('bill_no_seed', '1'),
  ('product_id_seed', '1'),
  ('staff_perms', '{}')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id        SERIAL PRIMARY KEY,
  username  TEXT UNIQUE NOT NULL,
  password  TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'STAFF'
);

-- Default admin + staff users
INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'ADMIN')
ON CONFLICT (username) DO NOTHING;
INSERT INTO users (username, password, role) VALUES ('staff', 'staff123', 'STAFF')
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT 'General',
  unit       TEXT NOT NULL DEFAULT 'Pcs',
  cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling    NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock      NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock  NUMERIC(12,2) NOT NULL DEFAULT 0,
  vendor     TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SALES BILLS
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_bills (
  bill_no          TEXT PRIMARY KEY,
  date_time        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  customer_name    TEXT NOT NULL DEFAULT '',
  customer_contact TEXT NOT NULL DEFAULT '',
  method           TEXT NOT NULL DEFAULT '',
  transfer_id      TEXT NOT NULL DEFAULT '',
  "user"           TEXT NOT NULL DEFAULT '',
  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'ACTIVE',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SALES LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_lines (
  line_id     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  bill_no     TEXT NOT NULL REFERENCES sales_bills(bill_no),
  date_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  item_id     TEXT NOT NULL DEFAULT '',
  item_name   TEXT NOT NULL DEFAULT '',
  qty         NUMERIC(12,2) NOT NULL DEFAULT 0,
  rate        NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_type   TEXT NOT NULL DEFAULT 'SALE',
  gst_rate    NUMERIC(6,4) NOT NULL DEFAULT 0,
  gst_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  "user"      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_lines_bill ON sales_lines(bill_no);

-- ============================================================
-- PURCHASE TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_transactions (
  id         SERIAL PRIMARY KEY,
  date_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bill_no    TEXT NOT NULL DEFAULT '',
  supplier   TEXT NOT NULL DEFAULT '',
  item_id    TEXT NOT NULL DEFAULT '',
  item_name  TEXT NOT NULL DEFAULT '',
  qty        NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  "user"     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ACTIVE',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STOCK LEDGER
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_ledger (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  date_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ref_type     TEXT NOT NULL DEFAULT '',
  ref_no       TEXT NOT NULL DEFAULT '',
  ref_line_id  TEXT NOT NULL DEFAULT '',
  item_id      TEXT NOT NULL DEFAULT '',
  item_name    TEXT NOT NULL DEFAULT '',
  qty_change   NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_rate     NUMERIC(6,4) NOT NULL DEFAULT 0,
  gst_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  "user"       TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT ''
);
