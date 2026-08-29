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
                    csId = '', csName = '', note = '', operator = '',
                    discount = 0, payMethod = '雨幣扣款', skipWallet = false }) {
  guildId = orgOf(guildId);
  const staff = getStaff(guildId, staffId);
  if (!staff || !staff.active) throw new Error('查無此陪玩（或已離職）');
  const g = findGift(guildId, giftKey);
  if (!g) throw new Error(`查無禮物款式「${giftKey}」`);
  const n = Math.max(1, Math.round(Number(qty) || 1));
  const list = g.price * n;
  const amount = Math.max(0, list - Math.round(discount));
  // 親密度依實付金額計算，與結帳同一套成數（預設 1 元 = 1 點）
  const gain = Math.round(amount * require('./money').intimacyRate(guildId) / 100);

  // 送禮不必報單核銷：分潤依「禮物定價」計算，結帳當下就直接進陪玩的可提領薪資
  const M = require('./money');
  const staffShare = Math.round(list * M.giftShareRate(guildId) / 100);

  // 送禮同樣是一筆營收，寫進 orders 流水帳（交易類型＝贈送禮物），才會進財務報表與匯出檔
  const order = M.createOrder({
    guildId, customerId, customerName, staffId, staffName: staff.name || staff.code,
    csId, csName, kind: 'gift', item: `${g.emoji} ${g.name}`, qty: n, unitPrice: g.price,
    listPrice: list, amount, staffShare, status: 'settled',
    // 折價券全額折抵時實付 0，一樣要能送出（分潤照禮物定價計）
    allowZero: amount === 0,
    source: 'gift', operator, orderPrefix: 'GFT',
    payMethod, skipWallet, intimacy: gain, note: note || `送禮 ${g.name}×${n}`
  });

  // createOrder 已經依 intimacy 參數加過羈絆，這裡只補送禮紀錄
  db.prepare(`INSERT INTO gift_logs (guild_id, order_no, customer_id, staff_id, gift_key, gift_name, qty, amount, intimacy)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(guildId, order.order_no, customerId, staffId, g.key, g.name, n, amount, gain);
  const points = getIntimacy(guildId, customerId, staffId);

  audit(operator || customerId, '送禮', `${g.name}×${n} = ${amount}`, guildId, { source: 'gifts' });
  return { gift: g, qty: n, list, amount, discount: list - amount, staffShare,
           gain, points, rank: rankOf(points), order };
}

// ---------- 背包 ----------
const listBackpack = (guildId, userId) =>
  db.prepare('SELECT * FROM backpack WHERE guild_id=? AND user_id=? AND qty > 0 ORDER BY id').all(orgOf(guildId), userId);

function addItem(guildId, userId, { key, name, qty = 1, value = 0, percent = 0, minSpend = 0, expires = null }) {
  guildId = orgOf(guildId);
  db.prepare(`INSERT INTO backpack (guild_id, user_id, item_key, name, qty, value, percent, min_spend, expires)
              VALUES (?,?,?,?,?,?,?,?,?)
              ON CONFLICT(guild_id, user_id, item_key)
              DO UPDATE SET qty = qty + excluded.qty, name = excluded.name,
                            value = excluded.value, percent = excluded.percent,
                            min_spend = excluded.min_spend, expires = excluded.expires`)
    .run(guildId, userId, key, name, Math.round(qty), Math.round(value),
         Math.round(percent), Math.round(minSpend), expires);
  return listBackpack(guildId, userId);
}

// ---------- 折價券 ----------
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

/**
 * percent 欄位存的是「折掉幾 %」（九折＝10），但很多人會照「打幾折」填成 90，
 * 結果整單只收一折。超過 50% 的折扣幾乎都是這種填反，擋下來要求確認。
 */
function assertPercent(percent) {
  const p = Number(percent) || 0;
  if (p > 50) throw new Error(
    `折扣填的是「折掉幾 %」不是「打幾折」：九折請填 10、95 折填 5。目前填 ${p} 等於只收 ${100 - p} 折。`);
  return p;
}

/** 這筆金額可用的折價券（面額或折扣、未過期、達門檻） */
function usableCoupons(guildId, userId, amount) {
  // 0 元券（例如「指定稱呼不加價」）也要能挑：它不折抵金額，但結帳時要一起消耗掉，
  // 才知道這張優惠已經用過了。
  return listBackpack(guildId, userId)
    .filter(x => (!x.expires || x.expires >= today()) && amount >= (x.min_spend || 0));
}

/** 這張券對這筆金額實際能折多少（不會超過訂單金額） */
function couponDiscount(coupon, amount) {
  if (!coupon) return 0;
  // 沒達到低消門檻就不折抵（呼叫端多半已用 usableCoupons 過濾，這裡再擋一次）
  if (coupon.min_spend && amount < coupon.min_spend) return 0;
  const off = coupon.percent > 0
    ? Math.floor(amount * coupon.percent / 100)
    : coupon.value;
  return Math.max(0, Math.min(amount, Math.round(off)));
}

/** 券在選單上的顯示：主標題與說明兩行 */
function couponOption(c, amount) {
  const cond = c.min_spend ? `（滿 NT$${Number(c.min_spend).toLocaleString('en-US')}）` : '';
  const off = couponDiscount(c, amount);
  // 折抵內容直接寫進主標題：同名的券（例如兩張都叫 TEST，一張折 10 元、一張 0 元）
  // 光看名稱分不出來，客服很容易選錯張。
  const what = c.percent > 0 ? `打 ${100 - c.percent} 折`
    : (c.value > 0 ? `折抵 ${c.value} 元` : '不折抵金額');
  return {
    label: `[背包] ${c.name}・${what}${cond} (剩 ${c.qty} 張)`,
    description: c.percent > 0
      ? `打 ${100 - c.percent} 折 (可折抵 ${off} 元)`
      : (c.value > 0 ? `可折抵 ${c.value} 元` : '優惠券（不折抵金額）')
  };
}
/** 單行版本（後台列表用） */
const couponLabel = c => {
  const base = c.percent > 0 ? `${c.name}（折 ${c.percent}%）`
    : (c.value > 0 ? `${c.name}（折抵 ${c.value} 元）` : `${c.name}（不折抵金額）`);
  return `${base}${c.min_spend ? `・滿 ${c.min_spend}` : ''}・剩 ${c.qty} 張`;
};

/** 使用一張券（扣 1 張，歸零就移除） */
function useCoupon(guildId, userId, key) {
  guildId = orgOf(guildId);
  const c = db.prepare('SELECT * FROM backpack WHERE guild_id=? AND user_id=? AND item_key=?')
    .get(guildId, userId, key);
  if (!c || c.qty < 1) throw new Error('這張折價券已經不在背包裡了');
  if (c.qty === 1) db.prepare('DELETE FROM backpack WHERE id=?').run(c.id);
  else db.prepare('UPDATE backpack SET qty = qty - 1 WHERE id=?').run(c.id);
  return c;
}

/**
 * 記下「這張單用掉了哪張券」。退單時要靠它把券原樣還回背包，
 * 只留訂單備註的文字是還原不回來的（面額、門檻、期限都在券本身）。
 */
function recordCouponUse(guildId, orderNo, userId, coupon, discount = 0) {
  if (!coupon || !orderNo) return;
  db.prepare(`INSERT INTO coupon_uses
      (guild_id, order_no, user_id, item_key, name, value, percent, min_spend, expires, discount)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(orgOf(guildId), orderNo, userId, coupon.item_key, coupon.name || '',
         coupon.value || 0, coupon.percent || 0, coupon.min_spend || 0,
         coupon.expires || null, Math.round(discount) || 0);
}

/** 退單／刪單時把券還回老闆的背包（同一張單只會還一次） */
function restoreCoupons(guildId, orderNo) {
  guildId = orgOf(guildId);
  const rows = db.prepare('SELECT * FROM coupon_uses WHERE guild_id=? AND order_no=? AND restored=0')
    .all(guildId, orderNo);
  for (const r of rows) {
    addItem(guildId, r.user_id, {
      key: r.item_key, name: r.name, qty: 1,
      value: r.value, percent: r.percent, minSpend: r.min_spend, expires: r.expires
    });
    db.prepare('UPDATE coupon_uses SET restored=1 WHERE id=?').run(r.id);
  }
  return rows;
}

/** 收回背包裡的券：不指定數量就整筆收回 */
function revokeItem(guildId, userId, key, qty = null) {
  guildId = orgOf(guildId);
  const c = db.prepare('SELECT * FROM backpack WHERE guild_id=? AND user_id=? AND item_key=?')
    .get(guildId, userId, key);
  if (!c) throw new Error('這位老闆的背包裡沒有這張券');
  const take = qty == null ? c.qty : Math.min(c.qty, Math.max(1, Math.round(qty)));
  if (take >= c.qty) db.prepare('DELETE FROM backpack WHERE id=?').run(c.id);
  else db.prepare('UPDATE backpack SET qty = qty - ? WHERE id=?').run(take, c.id);
  return { ...c, taken: take, left: Math.max(0, c.qty - take) };
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
  revokeItem, recordCouponUse, restoreCoupons,
  seedGifts, listGifts, findGift, sendGift,
  addIntimacy, getIntimacy, rankOf, RANKS,
  listBackpack, addItem, addTerritory,
  assertPercent, usableCoupons, couponDiscount, couponLabel, couponOption, useCoupon
};
