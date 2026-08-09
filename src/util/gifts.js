// 禮物、親密度、背包、地盤
const { db, now, getStaff, audit, orgOf } = require('../db');

// 預設禮物款式（首次啟動時寫入，後台可增修）
const DEFAULT_GIFTS = [
  ['catzong', '小貓粽',   '🍙', 50,    5],
  ['rose',    '玫瑰',     '🌹', 100,   10],
  ['milktea', '珍奶',     '🧋', 150,   15],
  ['cake',    '生日蛋糕', '🍰', 300,   30],
  ['bear',    '抱抱熊',   '🧸', 500,   50],
  ['perfume', '香水',     '💐', 800,   80],
  ['ring',    '戒指',     '💍', 1200,  130],
  ['crown',   '皇冠',     '👑', 2000,  220],
  ['fire',    '煙火',     '🎆', 3000,  340],
  ['car',     '超跑',     '🏎️', 5000,  600],
  ['yacht',   '遊艇',     '🛥️', 10000, 1300],
  ['jet',     '私人飛機', '✈️', 20000, 2800],
  ['island',  '海島',     '🏝️', 50000, 7500],
  ['castle',  '城堡',     '🏰', 88000, 14000],
  ['galaxy',  '銀河',     '🌌', 168000, 30000]
];

function seedGifts(guildId) {
  guildId = orgOf(guildId);
  const has = db.prepare('SELECT COUNT(*) c FROM gift_catalog WHERE guild_id = ?').get(guildId).c;
  if (has) return;
  const ins = db.prepare(`INSERT INTO gift_catalog (guild_id, key, name, emoji, price, intimacy, sort)
                          VALUES (?,?,?,?,?,?,?)`);
  db.transaction(() => DEFAULT_GIFTS.forEach((g, i) => ins.run(guildId, ...g, i)))();
}

const listGifts = guildId =>
  db.prepare('SELECT * FROM gift_catalog WHERE guild_id = ? AND active = 1 ORDER BY sort, price').all(orgOf(guildId));

function findGift(guildId, keyword) {
  guildId = orgOf(guildId);
  const k = String(keyword || '').trim();
  return db.prepare('SELECT * FROM gift_catalog WHERE guild_id = ? AND (key = ? OR name = ?) AND active = 1')
    .get(guildId, k, k);
}

/** 親密度加減；歸零時同步清除該 CP 的歷史禮物紀錄 */
function addIntimacy(guildId, customerId, staffId, delta) {
  guildId = orgOf(guildId);
  const row = db.prepare('SELECT points FROM intimacy WHERE guild_id=? AND customer_id=? AND staff_id=?')
    .get(guildId, customerId, staffId);
  const next = Math.max(0, (row ? row.points : 0) + Math.round(delta));
  db.prepare(`INSERT INTO intimacy (guild_id, customer_id, staff_id, points, updated_at) VALUES (?,?,?,?,?)
              ON CONFLICT(guild_id, customer_id, staff_id)
              DO UPDATE SET points = excluded.points, updated_at = excluded.updated_at`)
    .run(guildId, customerId, staffId, next, now());
  if (next === 0) {
    db.prepare('DELETE FROM gift_logs WHERE guild_id=? AND customer_id=? AND staff_id=?')
      .run(guildId, customerId, staffId);
  }
  return next;
}

const getIntimacy = (guildId, customerId, staffId) =>
  (db.prepare('SELECT points FROM intimacy WHERE guild_id=? AND customer_id=? AND staff_id=?')
    .get(orgOf(guildId), customerId, staffId) || { points: 0 }).points;

// 羈絆特權階級
const RANKS = [
  [0, '萍水相逢'], [500, '點頭之交'], [2000, '暖心夥伴'], [6000, '心動訊號'],
  [15000, '甜蜜戀人'], [40000, '生死相許'], [100000, '此生唯一']
];
function rankOf(points) {
  let cur = RANKS[0], next = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (points >= RANKS[i][0]) cur = RANKS[i];
    else { next = RANKS[i]; break; }
  }
  return { name: cur[1], next: next && { name: next[1], need: next[0] - points } };
}

/** 送禮：扣款、寫紀錄、親密度 ×2 */
function sendGift({ guildId, customerId, customerName = '', staffId, giftKey, qty = 1,
                    csId = '', csName = '', note = '', operator = '' }) {
  guildId = orgOf(guildId);
  const staff = getStaff(guildId, staffId);
  if (!staff || !staff.active) throw new Error('查無此陪玩（或已離職）');
  const g = findGift(guildId, giftKey);
  if (!g) throw new Error(`查無禮物款式「${giftKey}」`);
  const n = Math.max(1, Math.round(Number(qty) || 1));
  const amount = g.price * n;
  const gain = g.intimacy * n * 2;   // 雙倍親密度

  // 送禮同樣是一筆營收，寫進 orders 流水帳（交易類型＝贈送禮物），才會進財務報表與匯出檔
  const order = require('./money').createOrder({
    guildId, customerId, customerName, staffId, staffName: staff.name || staff.code,
    csId, csName, kind: 'gift', item: `${g.emoji} ${g.name}`, qty: n, unitPrice: g.price,
    amount, source: 'gift', operator, note: note || `送禮 ${g.name}×${n}`
  });

  let points;
  db.transaction(() => {
    db.prepare(`INSERT INTO gift_logs (guild_id, order_no, customer_id, staff_id, gift_key, gift_name, qty, amount, intimacy)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(guildId, order.order_no, customerId, staffId, g.key, g.name, n, amount, gain);
    points = addIntimacy(guildId, customerId, staffId, gain);
  })();

  audit(operator || customerId, '送禮', `${g.name}×${n} = ${amount}`, guildId);
  return { gift: g, qty: n, amount, gain, points, rank: rankOf(points), order };
}

// ---------- 背包 ----------
const listBackpack = (guildId, userId) =>
  db.prepare('SELECT * FROM backpack WHERE guild_id=? AND user_id=? AND qty > 0 ORDER BY id').all(orgOf(guildId), userId);

function addItem(guildId, userId, { key, name, qty = 1, value = 0, expires = null }) {
  guildId = orgOf(guildId);
  db.prepare(`INSERT INTO backpack (guild_id, user_id, item_key, name, qty, value, expires) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(guild_id, user_id, item_key)
              DO UPDATE SET qty = qty + excluded.qty, name = excluded.name,
                            value = excluded.value, expires = excluded.expires`)
    .run(guildId, userId, key, name, Math.round(qty), Math.round(value), expires);
  return listBackpack(guildId, userId);
}

// ---------- 地盤（步數超過 21 自動歸 0）----------
function addTerritory(guildId, userId, delta) {
  guildId = orgOf(guildId);
  const c = require('../db').getCustomer(guildId, userId);
  let v = c.territory + Math.round(Number(delta) || 0);
  let lapped = false;
  if (v > 21) { v = 0; lapped = true; }
  if (v < 0) v = 0;
  db.prepare('UPDATE customers SET territory = ? WHERE id = ?').run(v, c.id);
  return { steps: v, lapped };
}

module.exports = {
  seedGifts, listGifts, findGift, sendGift,
  addIntimacy, getIntimacy, rankOf, RANKS,
  listBackpack, addItem, addTerritory
};
