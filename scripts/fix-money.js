#!/usr/bin/env node
// 一次性的帳務更正，三件事：
//   A. 收回「現金單退單誤退的雨幣」（程式已修，這裡處理已經發生的部分）
//   B. 把舊系統轉入的餘額補一筆「期初餘額」進雨幣流水，之後餘額才對得起流水
//   C. 修正累計消費為負數的資料（會影響 VIP 判定）
//
// 用法：node scripts/fix-money.js            只試算，不寫入
//       node scripts/fix-money.js --apply    實際更新
const { db, addCoins, refreshVip, audit } = require('../src/db');

const APPLY = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');
// 舊系統資料轉入的時點：期初餘額掛在這個時間，排序時會排在所有新交易之前
const OPENING_AT = '2026-08-09 00:00:00';

// ---------- A. 收回現金單退單誤退的雨幣 ----------
console.log('【A】現金單退單誤退的雨幣\n');
const wrong = db.prepare(`
  SELECT o.order_no, o.guild_id, o.customer_id, o.amount, c.name, c.coins
  FROM orders o LEFT JOIN customers c ON c.guild_id=o.guild_id AND c.user_id=o.customer_id
  WHERE o.status='refunded' AND o.pay_method NOT LIKE '%雨幣%' AND o.amount > 0 AND o.customer_id != ''
    AND EXISTS (SELECT 1 FROM coin_tx t WHERE t.ref=o.order_no AND t.delta > 0)`).all();

const byCust = new Map();
for (const w of wrong) {
  const k = `${w.guild_id}|${w.customer_id}`;
  if (!byCust.has(k)) byCust.set(k, { ...w, total: 0, orders: [] });
  const e = byCust.get(k);
  e.total += w.amount;
  e.orders.push(w.order_no);
}
if (!byCust.size) console.log('  沒有需要處理的資料');
for (const e of byCust.values()) {
  const enough = e.coins >= e.total;
  console.log(`  ${(e.name || e.customer_id).padEnd(18)} 應收回 ${String(N(e.total)).padStart(7)}`
    + `　目前餘額 ${String(N(e.coins)).padStart(7)}　${enough ? '可全額收回' : '⚠ 餘額不足，將只收回現有餘額'}`
    + `\n      涉及 ${e.orders.length} 筆：${e.orders.join(', ')}`);
}

// ---------- B. 期初餘額 ----------
console.log('\n【B】補期初餘額，讓雨幣餘額與流水對得起來\n');
// A 會改變餘額，所以這裡先把 A 的收回金額算進去再比對
const openings = db.prepare(`
  SELECT c.guild_id, c.user_id, c.name, c.coins,
         COALESCE((SELECT SUM(t.delta) FROM coin_tx t
                   WHERE t.guild_id=c.guild_id AND t.user_id=c.user_id), 0) ledger
  FROM customers c`).all()
  .map(c => {
    const back = byCust.get(`${c.guild_id}|${c.user_id}`);
    const coinsAfterA = c.coins - Math.min(back ? back.total : 0, c.coins);
    const ledgerAfterA = c.ledger - Math.min(back ? back.total : 0, c.coins);
    return { ...c, opening: coinsAfterA - ledgerAfterA };
  })
  .filter(c => c.opening !== 0);
console.log(`  需要補期初餘額的老闆：${openings.length} 位`);
const posi = openings.filter(o => o.opening > 0).reduce((a, o) => a + o.opening, 0);
const nega = openings.filter(o => o.opening < 0).reduce((a, o) => a + o.opening, 0);
console.log(`  期初餘額合計：+${N(posi)}　${N(nega)}`);
openings.slice(0, 8).forEach(o =>
  console.log(`    ${(o.name || o.user_id).padEnd(18)} 餘額 ${String(N(o.coins)).padStart(8)}`
    + `　流水 ${String(N(o.ledger)).padStart(9)}　期初 ${String(N(o.opening)).padStart(9)}`));
if (openings.length > 8) console.log(`    …另有 ${openings.length - 8} 位`);

// ---------- C. 累計消費負數 ----------
console.log('\n【C】累計消費為負數\n');
const negSpend = db.prepare('SELECT guild_id, user_id, name, total_spend FROM customers WHERE total_spend < 0').all();
if (!negSpend.length) console.log('  沒有需要處理的資料');
negSpend.forEach(c => console.log(`  ${(c.name || c.user_id).padEnd(18)} ${N(c.total_spend)} → 0`));

if (!APPLY) {
  console.log('\n這只是試算，沒有寫入任何資料。確認無誤後加上 --apply 實際更新。');
  process.exit(0);
}

// ---------- 實際寫入 ----------
let backTotal = 0;
for (const e of byCust.values()) {
  const take = Math.min(e.total, e.coins);          // 餘額不夠就收回現有的，不讓餘額變負數
  if (take <= 0) continue;
  addCoins(e.guild_id, e.customer_id, -take,
    `更正：現金單退單誤退雨幣（${e.orders.join('、')}）`, { operator: 'system' });
  backTotal += take;
}

const insOpening = db.prepare(`INSERT INTO coin_tx (guild_id, user_id, delta, balance, reason, operator, created_at)
                               VALUES (?,?,?,?,?,'system',?)`);
db.transaction(() => {
  for (const o of openings) {
    // balance 欄位填期初餘額本身：它是這條流水的第一筆，之後每筆的 balance 才接得下去
    insOpening.run(o.guild_id, o.user_id, o.opening, o.opening, '舊系統轉入期初餘額', OPENING_AT);
  }
  for (const c of negSpend) {
    db.prepare('UPDATE customers SET total_spend = 0 WHERE guild_id=? AND user_id=?').run(c.guild_id, c.user_id);
  }
})();
for (const c of negSpend) refreshVip(c.guild_id, c.user_id);

audit('system', '帳務更正',
  `收回誤退雨幣 ${backTotal}、補期初餘額 ${openings.length} 位、修正負數累計消費 ${negSpend.length} 位`,
  openings[0]?.guild_id || '', { source: 'salary' });

console.log(`\n已完成：收回 ${N(backTotal)} 雨幣、補 ${openings.length} 筆期初餘額、修正 ${negSpend.length} 筆累計消費。`);
