// 喚雨星象 · 每日抽籤：抽到折價券直接進背包，其餘給一句運勢籤詩
const { db, orgOf, now, audit } = require('../db');
const G = require('./gifts');

const today = () => now().slice(0, 10);

// 預設獎池：[名稱, emoji, 類型, 折抵金額, 折扣%, 低消, 有效天數, 籤詩, 權重, 排序]
// 類型 coupon＝發折價券進背包，fortune＝純運勢籤詩（不發獎品）。
// 後台「投票與意見箱 → 每日抽籤獎池」可改；這裡只在該集團完全沒獎項時灌一次。
const SEED = [
  ['大吉', '🎊', 'fortune', 0, 0, 0, 0, '雲收雨霽，星河為你讓路——今日所求，皆會應答。', 5, 0],
  ['中吉', '✨', 'fortune', 0, 0, 0, 0, '細雨潤物，好事正在來的路上，別急著關窗。', 12, 1],
  ['小吉', '🍀', 'fortune', 0, 0, 0, 0, '微風有信，今天適合主動說一句想說很久的話。', 18, 2],
  ['吉', '🌤️', 'fortune', 0, 0, 0, 0, '雲淡風輕，穩穩地走，該遇見的都在前面。', 20, 3],
  ['末吉', '☁️', 'fortune', 0, 0, 0, 0, '天色未明，先把自己照顧好，運勢會慢慢轉晴。', 25, 4],
  ['小凶', '🌧️', 'fortune', 0, 0, 0, 0, '今日有雨，宜安靜宜休息，別做太大的決定。', 20, 5]
];

/** 該集團目前有效的獎池；被刪光或全停用時退回預設，避免抽籤直接壞掉 */
function pool(guildId) {
  const org = orgOf(guildId);
  seed(guildId);
  const rows = db.prepare('SELECT * FROM lottery_prizes WHERE guild_id=? AND enabled=1 AND weight>0 ORDER BY sort, id')
    .all(org);
  if (rows.length) return rows;
  return SEED.map(([name, emoji, type, value, percent, min_spend, expire_days, text, weight]) =>
    ({ name, emoji, type, value, percent, min_spend, expire_days, text, weight }));
}

function seed(guildId) {
  const org = orgOf(guildId);
  if (db.prepare('SELECT 1 FROM lottery_prizes WHERE guild_id=? LIMIT 1').get(org)) return;
  const ins = db.prepare(`INSERT INTO lottery_prizes
    (guild_id, name, emoji, type, value, percent, min_spend, expire_days, text, weight, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => { for (const p of SEED) ins.run(org, ...p); })();
}

/** 今天抽過了嗎（台北時間，每日 0 點重置） */
const drewToday = (guildId, userId) =>
  !!db.prepare('SELECT 1 FROM lottery_draws WHERE guild_id=? AND user_id=? AND day=?')
    .get(orgOf(guildId), userId, today());

/** 到期日：expire_days 天後（0 代表不過期） */
function expiresAt(days) {
  if (!days || days <= 0) return null;
  const d = new Date(`${today()}T00:00:00+08:00`);
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/**
 * 抽一次。已經抽過會丟錯，讓呼叫端直接顯示訊息。
 * 回傳 { prize, coupon }：coupon 是這次發進背包的券（沒中券就是 null）。
 */
function draw(guildId, userId, userName = '') {
  const org = orgOf(guildId);
  if (drewToday(guildId, userId)) throw new Error('你今天已經抽過籤了，明天再來 ☔');

  const prizes = pool(guildId);
  const total = prizes.reduce((a, p) => a + Number(p.weight || 0), 0);
  let r = Math.random() * total, prize = prizes[prizes.length - 1];
  for (const p of prizes) { r -= Number(p.weight || 0); if (r <= 0) { prize = p; break; } }

  // 先記錄再發獎：同一秒連按兩次時，第二次會因為 UNIQUE 衝突而抽不到
  const ins = db.prepare('INSERT INTO lottery_draws (guild_id, user_id, day, prize) VALUES (?,?,?,?)')
    .run(org, userId, today(), prize.name);
  if (!ins.changes) throw new Error('你今天已經抽過籤了，明天再來 ☔');

  let coupon = null;
  if (prize.type === 'coupon' && (Number(prize.value) > 0 || Number(prize.percent) > 0)) {
    const name = `${prize.emoji || '🎟️'} 星象${prize.name}券`;
    coupon = {
      // 同一種籤的券會累加張數，不會蓋掉客服另外發的券
      key: `lot_${(prize.id || prize.name)}`,
      name,
      value: Number(prize.value) || 0,
      percent: Number(prize.percent) || 0,
      minSpend: Number(prize.min_spend) || 0,
      expires: expiresAt(prize.expire_days)
    };
    G.addItem(guildId, userId, { ...coupon, qty: 1 });
    audit(userName || userId, '每日抽籤', `${prize.name} → ${name}`, org, { source: 'discord' });
  }
  return { prize, coupon };
}

module.exports = { draw, pool, seed, drewToday, today, SEED };
