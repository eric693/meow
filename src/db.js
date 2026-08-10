// 資料庫連線與共用資料存取
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'meow.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// 舊資料庫升級：schema.sql 的 CREATE TABLE IF NOT EXISTS 不會補欄位，這裡逐一補上。
function ensureColumns(table, cols) {
  // 資料表還不存在（全新資料庫）就跳過，交給 schema.sql 直接建好
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return;
  const have = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  for (const [name, ddl] of cols) {
    if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}
ensureColumns('orders', [
  ['customer_name', "TEXT NOT NULL DEFAULT ''"],
  ['staff_name',    "TEXT NOT NULL DEFAULT ''"],
  ['cs_name',       "TEXT NOT NULL DEFAULT ''"],
  ['kind',          "TEXT NOT NULL DEFAULT 'order'"],
  ['list_price',    'INTEGER NOT NULL DEFAULT 0'],
  ['net',           'INTEGER NOT NULL DEFAULT 0'],
  ['pay_method',    "TEXT NOT NULL DEFAULT '雨幣扣款'"],
  ['reporter_id',   "TEXT NOT NULL DEFAULT ''"],
  ['reported_at',   'TEXT'],
  ['intimacy',      'INTEGER NOT NULL DEFAULT 0']
]);
ensureColumns('audit_logs', [
  ['actor_id',   "TEXT NOT NULL DEFAULT ''"],
  ['source',     "TEXT NOT NULL DEFAULT 'system'"],
  ['channel_id', "TEXT NOT NULL DEFAULT ''"],
  ['status',     "TEXT NOT NULL DEFAULT 'ok'"]
]);
ensureColumns('backpack', [
  ['percent',   'INTEGER NOT NULL DEFAULT 0'],
  ['min_spend', 'INTEGER NOT NULL DEFAULT 0']
]);
ensureColumns('gift_logs', [['order_no', "TEXT NOT NULL DEFAULT ''"]]);
ensureColumns('tickets', [
  ['src_guild', "TEXT NOT NULL DEFAULT ''"],
  ['seq',       'INTEGER NOT NULL DEFAULT 0'],
  ['service',   "TEXT NOT NULL DEFAULT ''"],
  ['gender',    "TEXT NOT NULL DEFAULT ''"],
  ['rank',      "TEXT NOT NULL DEFAULT ''"],
  ['play_at',   "TEXT NOT NULL DEFAULT ''"],
  ['duration',  "TEXT NOT NULL DEFAULT ''"],
  ['addons',    "TEXT NOT NULL DEFAULT ''"],
  ['publish',   "TEXT NOT NULL DEFAULT 'draft'"],
  ['published_at', 'TEXT']
]);
ensureColumns('exams', [['src_guild', "TEXT NOT NULL DEFAULT ''"]]);
// 舊資料補算原價與淨利
db.exec("UPDATE orders SET list_price = amount WHERE list_price = 0 AND amount <> 0");
db.exec("UPDATE orders SET net = amount - staff_share WHERE net = 0 AND amount <> 0");

db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

const SECRET = process.env.JWT_SECRET || 'meow-dev-secret-change-me';
const HOME_GUILD = process.env.GUILD_ID || '';

// ---------- 時間 ----------
const now = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace('T', ' ');
const monthPrefix = (d = new Date()) =>
  d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 7); // YYYY-MM

// ---------- 集團（跨伺服器串接）----------
// 陪玩群、員工群等多台伺服器綁在同一個 org_id 後，所有營運資料（訂單、錢包、
// 薪資、財務、客服業績、人事、親密度）都存在同一個 org_id 底下，兩邊看到同一份帳。
// 面板設定（身分組、頻道、分類）仍然是各群獨立的——那本來就該不一樣。
const orgCache = new Map();
function orgOf(guildId) {
  const g = String(guildId || '');
  if (!g) return g;
  if (orgCache.has(g)) return orgCache.get(g);
  const r = db.prepare('SELECT org_id FROM guild_org WHERE guild_id = ?').get(g);
  const org = r ? r.org_id : g;
  orgCache.set(g, org);
  return org;
}
function bindOrg(guildId, orgId, label = '') {
  if (!orgId || orgId === guildId) {
    db.prepare('DELETE FROM guild_org WHERE guild_id = ?').run(guildId);
  } else {
    db.prepare(`INSERT INTO guild_org (guild_id, org_id, label) VALUES (?,?,?)
                ON CONFLICT(guild_id) DO UPDATE SET org_id = excluded.org_id, label = excluded.label`)
      .run(guildId, orgId, label);
  }
  orgCache.clear();
}
/** 同一集團底下的所有伺服器 ID（含未綁定時的自己） */
function orgGuilds(orgId) {
  const rows = db.prepare('SELECT guild_id FROM guild_org WHERE org_id = ?').all(orgId).map(r => r.guild_id);
  return rows.includes(orgId) ? rows : [orgId, ...rows];
}
/** 把整個集團的營運資料搬到新的 org_id（綁定時使用，避免舊帳失聯） */
const ORG_TABLES = ['staff', 'customers', 'orders', 'coin_tx', 'withdrawals', 'gift_catalog',
                    'gift_logs', 'intimacy', 'backpack', 'tickets', 'exams', 'suggestions', 'cs_stats'];
function migrateOrgData(fromOrg, toOrg) {
  if (!fromOrg || !toOrg || fromOrg === toOrg) return 0;
  let moved = 0;
  db.transaction(() => {
    for (const t of ORG_TABLES) {
      try { moved += db.prepare(`UPDATE OR IGNORE ${t} SET guild_id = ? WHERE guild_id = ?`).run(toOrg, fromOrg).changes; }
      catch (e) { console.warn(`搬移 ${t} 失敗：`, e.message); }
    }
  })();
  return moved;
}

// ---------- 設定 ----------
function getSetting(key, def = '', guildId = '') {
  const r = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
  return r ? r.value : def;
}
function setSetting(key, value, guildId = '') {
  db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?)
              ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`)
    .run(guildId, key, value == null ? '' : String(value));
}
function getNum(key, def, guildId = '') {
  const v = getSetting(key, '', guildId);
  const n = Number(v);
  return v === '' || Number.isNaN(n) ? def : n;
}

// 通用稽核紀錄。opts 供 Discord 端補上操作者 ID、來源、頻道與成敗狀態。
function audit(actor, action, detail = '', guildId = '',
               { actorId = '', source = 'system', channelId = '', status = 'ok' } = {}) {
  guildId = orgOf(guildId);
  db.prepare(`INSERT INTO audit_logs (guild_id, actor, actor_id, action, detail, source, channel_id, status)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(guildId, String(actor || ''), String(actorId || ''), action,
         String(detail || '').slice(0, 500), source, String(channelId || ''), status);
}

function activeGuildIds() {
  const rows = db.prepare('SELECT guild_id FROM guilds WHERE active = 1').all().map(r => r.guild_id);
  return rows.length ? rows : (HOME_GUILD ? [HOME_GUILD] : []);
}
function upsertGuild(id, name) {
  db.prepare(`INSERT INTO guilds (guild_id, name) VALUES (?, ?)
              ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name, active = 1`).run(id, name || '');
}

// ---------- 老闆 ----------
function getCustomer(guildId, userId, name = '') {
  guildId = orgOf(guildId);
  let c = db.prepare('SELECT * FROM customers WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!c) {
    db.prepare('INSERT INTO customers (guild_id, user_id, name) VALUES (?, ?, ?)').run(guildId, userId, name);
    c = db.prepare('SELECT * FROM customers WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  } else if (name && c.name !== name) {
    db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name, c.id);
    c.name = name;
  }
  return c;
}

// VIP 門檻：settings 的 vip_thresholds（逗號分隔 7 個數字，對應 Lv1~Lv7）
const DEFAULT_VIP = [1000, 5000, 20000, 50000, 100000, 300000, 1000000];
function vipThresholds(guildId = '') {
  guildId = orgOf(guildId);
  const raw = getSetting('vip_thresholds', '', guildId);
  const arr = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
  return arr.length === 7 ? arr : DEFAULT_VIP;
}
function vipLevelFor(total, guildId = '') {
  const t = vipThresholds(guildId);
  let lv = 0;
  for (let i = 0; i < t.length; i++) if (total >= t[i]) lv = i + 1;
  return lv;
}
function refreshVip(guildId, userId) {
  guildId = orgOf(guildId);
  const c = getCustomer(guildId, userId);
  if (c.vip_locked) return c.vip_level;
  const lv = vipLevelFor(c.total_spend, guildId);
  if (lv !== c.vip_level) db.prepare('UPDATE customers SET vip_level = ? WHERE id = ?').run(lv, c.id);
  return lv;
}

// ---------- 雨幣 ----------
// delta 可正可負；扣款不足時丟錯（allowNegative=true 可強制）
function addCoins(guildId, userId, delta, reason, { ref = '', operator = '', allowNegative = false, name = '' } = {}) {
  guildId = orgOf(guildId);
  const c = getCustomer(guildId, userId, name);
  const next = c.coins + Math.round(delta);
  if (next < 0 && !allowNegative) {
    const e = new Error(`雨幣不足：目前 ${c.coins}，需要 ${Math.abs(Math.round(delta))}`);
    e.code = 'INSUFFICIENT';
    throw e;
  }
  db.prepare('UPDATE customers SET coins = ? WHERE id = ?').run(next, c.id);
  db.prepare('INSERT INTO coin_tx (guild_id, user_id, delta, balance, reason, ref, operator) VALUES (?,?,?,?,?,?,?)')
    .run(guildId, userId, Math.round(delta), next, reason, ref, operator);
  return next;
}

// ---------- 陪玩 / 客服 ----------
function getStaff(guildId, userId) {
  guildId = orgOf(guildId);
  return db.prepare('SELECT * FROM staff WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}
function findStaff(guildId, keyword) {
  guildId = orgOf(guildId);
  const k = String(keyword || '').trim();
  if (!k) return null;
  const id = (k.match(/\d{15,25}/) || [])[0];
  if (id) {
    const byId = getStaff(guildId, id);
    if (byId) return byId;
  }
  return db.prepare(`SELECT * FROM staff WHERE guild_id = ? AND (code = ? OR name = ?) ORDER BY active DESC LIMIT 1`)
    .get(guildId, k, k);
}

// ---------- 訂單編號 ----------
// 格式 ORD-12345678（8 碼隨機，避免外人從編號推算單量）
function nextOrderNo() {
  const exists = db.prepare('SELECT 1 FROM orders WHERE order_no = ?');
  for (let i = 0; i < 50; i++) {
    const no = `ORD-${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    if (!exists.get(no)) return no;
  }
  throw new Error('訂單編號產生失敗，請稍後再試');
}

module.exports = {
  db, SECRET, HOME_GUILD, now, monthPrefix,
  getSetting, setSetting, getNum, audit, activeGuildIds, upsertGuild,
  orgOf, bindOrg, orgGuilds, migrateOrgData,
  getCustomer, vipThresholds, vipLevelFor, refreshVip, addCoins,
  getStaff, findStaff, nextOrderNo, DEFAULT_VIP
};
