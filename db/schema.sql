-- 喚雨機器喵 資料庫結構（SQLite）
-- 所有金額單位皆為「雨幣」；時間一律存 Asia/Taipei 的 'YYYY-MM-DD HH:MM:SS' 字串。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- 後台帳號 ----------
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'staff',   -- admin / staff
  permissions   TEXT NOT NULL DEFAULT '',        -- 逗號分隔的模組 key
  guild_ids     TEXT NOT NULL DEFAULT '',        -- 逗號分隔；空= 主伺服器
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- 伺服器 ----------
CREATE TABLE IF NOT EXISTS guilds (
  guild_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- 集團綁定 ----------
-- 「陪玩群」與「員工群」等多台伺服器可綁在同一個 org_id，
-- 從此訂單、錢包、薪資、財務、客服業績、人事名單全部共用同一份資料。
-- 未綁定的伺服器，org_id 就等於它自己的 guild_id（獨立運作）。
CREATE TABLE IF NOT EXISTS guild_org (
  guild_id TEXT PRIMARY KEY,
  org_id   TEXT NOT NULL,
  label    TEXT NOT NULL DEFAULT ''    -- 例：陪玩群 / 員工群
);
CREATE INDEX IF NOT EXISTS idx_guild_org ON guild_org (org_id);

-- ---------- 設定（per-guild，guild_id 空字串= 全域）----------
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT NOT NULL DEFAULT '',
  key      TEXT NOT NULL,
  value    TEXT,
  PRIMARY KEY (guild_id, key)
);

-- ---------- 操作紀錄 ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL DEFAULT '',
  actor      TEXT NOT NULL DEFAULT '',
  actor_id   TEXT NOT NULL DEFAULT '',        -- Discord ID（後台操作為空）
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'system',   -- prefix / slash / button / modal / web / system
  channel_id TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ok',       -- ok 成功 / fail 失敗 / deny 權限不足
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs (guild_id, actor_id, created_at DESC);

-- ---------- 人事：陪玩師 / 客服 ----------
CREATE TABLE IF NOT EXISTS staff (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,          -- Discord ID
  code           TEXT NOT NULL DEFAULT '',   -- 代號
  name           TEXT NOT NULL DEFAULT '',   -- 藝名
  card_url       TEXT NOT NULL DEFAULT '',   -- 影音名片網址
  kind           TEXT NOT NULL DEFAULT 'player', -- player 陪玩 / cs 客服
  income         INTEGER NOT NULL DEFAULT 0,  -- 可提領
  pending_income INTEGER NOT NULL DEFAULT 0,  -- 暫存（未核銷）
  total_income   INTEGER NOT NULL DEFAULT 0,  -- 歷史累計已入帳
  active         INTEGER NOT NULL DEFAULT 1,
  joined_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_code ON staff (guild_id, code);

-- ---------- 老闆（客人）----------
CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  coins        INTEGER NOT NULL DEFAULT 0,   -- 雨幣餘額（地下金庫）
  total_spend  INTEGER NOT NULL DEFAULT 0,   -- 歷史累計消費
  vip_level    INTEGER NOT NULL DEFAULT 0,   -- 0~7
  vip_locked   INTEGER NOT NULL DEFAULT 0,   -- 1 = 管理員手動鎖定等級
  territory    INTEGER NOT NULL DEFAULT 0,   -- 地盤步數 0~21
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (guild_id, user_id)
);

-- ---------- 訂單（報單）----------
CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no     TEXT NOT NULL UNIQUE,
  guild_id     TEXT NOT NULL,
  customer_id  TEXT NOT NULL,               -- 老闆 Discord ID
  staff_id     TEXT NOT NULL,               -- 陪玩 Discord ID
  cs_id        TEXT NOT NULL DEFAULT '',    -- 經辦客服 Discord ID
  customer_name TEXT NOT NULL DEFAULT '',   -- 金主名稱（快照，匯出用）
  staff_name   TEXT NOT NULL DEFAULT '',    -- 陪玩名稱（快照）
  cs_name      TEXT NOT NULL DEFAULT '',    -- 經辦客服名稱（快照）
  kind         TEXT NOT NULL DEFAULT 'order', -- order 一般訂單 / gift 贈送禮物 / role 身分組結帳 / adjust 系統調整
  item         TEXT NOT NULL DEFAULT '',    -- 項目（遊戲/唱歌…）
  qty          REAL NOT NULL DEFAULT 1,     -- 時數或局數
  unit_price   INTEGER NOT NULL DEFAULT 0,
  list_price   INTEGER NOT NULL DEFAULT 0,  -- 訂單原價（未折扣）
  amount       INTEGER NOT NULL DEFAULT 0,  -- 實收金額
  staff_share  INTEGER NOT NULL DEFAULT 0,  -- 陪玩抽成
  net          INTEGER NOT NULL DEFAULT 0,  -- 伺服器淨利 = 實收 - 抽成
  source       TEXT NOT NULL DEFAULT 'self',-- self 自主報單 / cross 跨服1 / cross2 唱歌跨服 / ticket 派單 / import 匯入
  status       TEXT NOT NULL DEFAULT 'pending', -- pending 暫存中 / settled 已核銷 / refunded 已退單撤銷
  note         TEXT NOT NULL DEFAULT '',
  pay_method   TEXT NOT NULL DEFAULT '雨幣扣款', -- 支付方式（雨幣扣款／現金／免費體驗…）
  intimacy     INTEGER NOT NULL DEFAULT 0,     -- 本單產生的親密度（退單時原數回沖）
  reporter_id  TEXT NOT NULL DEFAULT '',    -- 回報此單的員工 Discord ID
  reported_at  TEXT,                        -- 陪玩在員工群報單的時間
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  settled_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_guild_time ON orders (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (guild_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_staff ON orders (guild_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (guild_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_kind ON orders (guild_id, kind);
CREATE INDEX IF NOT EXISTS idx_orders_cs ON orders (guild_id, cs_id);

-- ---------- 雨幣流水 ----------
CREATE TABLE IF NOT EXISTS coin_tx (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  balance    INTEGER NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  ref        TEXT NOT NULL DEFAULT '',     -- 關聯訂單編號等
  operator   TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cointx ON coin_tx (guild_id, user_id, created_at DESC);

-- ---------- 提領 ----------
CREATE TABLE IF NOT EXISTS withdrawals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  staff_id   TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending / done / rejected
  operator   TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  done_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_wd ON withdrawals (guild_id, created_at DESC);

-- ---------- 禮物 ----------
CREATE TABLE IF NOT EXISTS gift_catalog (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  name     TEXT NOT NULL,
  emoji    TEXT NOT NULL DEFAULT '🎁',
  price    INTEGER NOT NULL DEFAULT 0,
  intimacy INTEGER NOT NULL DEFAULT 0,   -- 單份親密度（送禮時 ×2）
  sort     INTEGER NOT NULL DEFAULT 0,
  active   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (guild_id, key)
);

CREATE TABLE IF NOT EXISTS gift_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  staff_id    TEXT NOT NULL,
  order_no    TEXT NOT NULL DEFAULT '',   -- 對應流水帳的訂單編號
  gift_key    TEXT NOT NULL,
  gift_name   TEXT NOT NULL DEFAULT '',
  qty         INTEGER NOT NULL DEFAULT 1,
  amount      INTEGER NOT NULL DEFAULT 0,
  intimacy    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_gift_pair ON gift_logs (guild_id, customer_id, staff_id);

-- ---------- 親密度（CP）----------
CREATE TABLE IF NOT EXISTS intimacy (
  guild_id    TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  staff_id    TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (guild_id, customer_id, staff_id)
);

-- ---------- 背包（道具／折價券）----------
CREATE TABLE IF NOT EXISTS backpack (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  item_key TEXT NOT NULL,
  name     TEXT NOT NULL DEFAULT '',
  qty      INTEGER NOT NULL DEFAULT 1,
  value    INTEGER NOT NULL DEFAULT 0,   -- 折價券面額（固定折抵金額）
  percent  INTEGER NOT NULL DEFAULT 0,   -- 折扣百分比（95 折填 5，代表折抵 5%）
  min_spend INTEGER NOT NULL DEFAULT 0,  -- 最低消費門檻（滿額才能用）
  expires  TEXT,
  UNIQUE (guild_id, user_id, item_key)
);

-- ---------- 客服單 / 派單 ----------
CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  src_guild   TEXT NOT NULL DEFAULT '',   -- 實際開單的伺服器
  channel_id  TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL,
  cs_id       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'order',  -- order 下單 / exam 考核 / suggestion 建議 / staff 員工輔導
  status      TEXT NOT NULL DEFAULT 'open',   -- open / claimed / closed
  subject     TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  seq         INTEGER NOT NULL DEFAULT 0,     -- 全店連號的單號（頻道名稱用）
  service     TEXT NOT NULL DEFAULT '',       -- 服務類型（特戰英豪／唱歌單曲…）
  gender      TEXT NOT NULL DEFAULT '',       -- 偏好性別
  rank        TEXT NOT NULL DEFAULT '',       -- 老闆目前段位
  play_at     TEXT NOT NULL DEFAULT '',       -- 希望時段
  duration    TEXT NOT NULL DEFAULT '',       -- 預計時長
  addons      TEXT NOT NULL DEFAULT '',       -- 附加選項（逗號分隔）
  publish     TEXT NOT NULL DEFAULT 'draft',  -- draft 尚未發布 / public 公開單 / anon 匿名單
  published_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  claimed_at  TEXT,
  closed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_ticket ON tickets (guild_id, kind, created_at DESC);

-- ---------- 投票 ----------
CREATE TABLE IF NOT EXISTS polls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL,
  options    TEXT NOT NULL DEFAULT '[]',
  anonymous  INTEGER NOT NULL DEFAULT 1,
  closed     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  choice  INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);

-- ---------- 考核 ----------
CREATE TABLE IF NOT EXISTS exams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  nickname   TEXT NOT NULL DEFAULT '',
  age        TEXT NOT NULL DEFAULT '',
  skills     TEXT NOT NULL DEFAULT '',
  contact    TEXT NOT NULL DEFAULT '',
  src_guild  TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending', -- pending / passed / failed
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- 意見箱 ----------
CREATE TABLE IF NOT EXISTS suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'public',  -- public 意見投訴 / staff 員工輔導室
  content    TEXT NOT NULL,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- 客服接單業績 ----------
CREATE TABLE IF NOT EXISTS cs_stats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  cs_id      TEXT NOT NULL,
  ticket_id  INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cs ON cs_stats (guild_id, created_at);
