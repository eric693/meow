#!/usr/bin/env node
// 把「沒有帶到老闆 Discord ID」的單補回本人。
// 只補身分與累計消費，不動雨幣餘額——那筆錢當初沒扣過，要不要補扣是另一個決定。
// 用法：node scripts/fix-orphan-order.js            → 試算
//       node scripts/fix-orphan-order.js --apply    → 寫入
const { db, refreshVip, audit } = require('../src/db');

const apply = process.argv.includes('--apply');
const ORDER = 'ORD-50148016';
const OWNER = '856098594306523136';   // 陪玩名 123123 ／ 老闆名 tsuki_.32，同一個 Discord 帳號

const o = db.prepare('SELECT * FROM orders WHERE order_no=?').get(ORDER);
if (!o) { console.log('查無此單'); process.exit(1); }
if (o.customer_id) { console.log(`${ORDER} 已經有老闆（${o.customer_id}），不需處理`); process.exit(0); }

const c = db.prepare('SELECT * FROM customers WHERE guild_id=? AND user_id=?').get(o.guild_id, OWNER);
if (!c) { console.log('查無這位老闆'); process.exit(1); }

console.log(`訂單 ${ORDER}：${o.item} ${o.amount} 元（${o.created_at}）`);
console.log(`  老闆欄目前：空白（名稱記著「${o.customer_name}」）`);
console.log(`  要補成：${c.name}（${OWNER}）`);
console.log(`  累計消費：${c.total_spend.toLocaleString()} → ${(c.total_spend + o.amount).toLocaleString()}`);
console.log(`  雨幣餘額：${c.coins.toLocaleString()}（不變，這筆當初沒扣過）`);

if (!apply) { console.log('\n（試算模式，未寫入。確定要套用請加 --apply）'); process.exit(0); }

db.transaction(() => {
  db.prepare('UPDATE orders SET customer_id=?, customer_name=? WHERE order_no=?')
    .run(OWNER, c.name || o.customer_name, ORDER);
  db.prepare('UPDATE customers SET total_spend = total_spend + ? WHERE guild_id=? AND user_id=?')
    .run(o.amount, o.guild_id, OWNER);
})();
const vip = refreshVip(o.guild_id, OWNER);
audit('系統維護', '補上訂單的老闆', `${ORDER} → ${OWNER}`, o.guild_id, { source: 'script' });
console.log(`\n✅ 已補上。目前 VIP 等級：Lv.${vip}`);
