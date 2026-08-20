#!/usr/bin/env node
// 收回 ORD-65261736（月冠母單）誤退的 65,000 雨幣。
//
// 這張母單在舊系統就已經拆成兩張子單：
//   ORD-00979124「已還單」9,875 ＋ ORD-01009038「未還單」56,125 ＝ 66,000（母單原價）
// 母單因此是重複的，8/17 把它退單作廢本身沒錯，錯在「連雨幣一起退」：
// 三張單都是匯入的資料，在這套系統裡從沒扣過老闆的雨幣，
// 舊系統的扣款早已反映在匯入的餘額裡，再退一次就等於白送。
//
// 用法：node scripts/fix-monthly-crown-refund.js [--apply]
const { db, orgOf, addCoins, refreshVip, audit } = require('../src/db');

const APPLY = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');
const ORDER = 'ORD-65261736';
const AMOUNT = 65000;

const org = orgOf('1485661086249259088');
const o = db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?').get(org, ORDER);
if (!o) { console.error(`查無訂單 ${ORDER}`); process.exit(1); }

const c = db.prepare('SELECT name, coins, total_spend FROM customers WHERE guild_id=? AND user_id=?')
  .get(org, o.customer_id);
// 只認這支腳本要沖銷的那筆退款，避免重複執行
const refund = db.prepare(`SELECT * FROM coin_tx WHERE guild_id=? AND ref=? AND delta > 0
                           ORDER BY id DESC LIMIT 1`).get(org, ORDER);
const already = db.prepare(`SELECT 1 FROM coin_tx WHERE guild_id=? AND ref=? AND delta < 0
                            AND reason LIKE '更正：月冠母單%'`).get(org, ORDER);

console.log(`訂單 ${ORDER}｜${o.customer_name}｜原價 ${N(o.list_price)}／實付 ${N(o.amount)}｜狀態 ${o.status}`);
console.log(`備註：${o.note}\n`);
console.log('拆分後的子單：');
db.prepare(`SELECT order_no, status, amount, staff_share, note FROM orders
            WHERE guild_id=? AND note LIKE '%月冠拆單%' ORDER BY created_at`).all(org)
  .forEach(x => console.log(`  ${x.order_no}  ${String(N(x.amount)).padStart(7)}（抽成 ${N(x.staff_share)}）`
    + `  ${x.status === 'settled' ? '已核銷' : x.status === 'pending' ? '未核銷' : x.status}`));

console.log(`\n8/17 那筆退款：${refund ? `+${N(refund.delta)}（${refund.created_at}）` : '（找不到）'}`);
console.log(`老闆現況：${c.name}　雨幣 ${N(c.coins)}　累計消費 ${N(c.total_spend)}`);
console.log(`\n要執行的更正：`);
console.log(`  雨幣　　 ${N(c.coins)} → ${N(c.coins - AMOUNT)}（收回 ${N(AMOUNT)}）`);
console.log(`  累計消費 ${N(c.total_spend)} → ${N(c.total_spend + AMOUNT)}（退單時被扣掉，一併還原）`);
console.log(`  訂單狀態維持「已退單」——母單重複，作廢是對的，只是不該退幣`);
console.log(`  陪玩薪資不動：子單 ORD-01009038 的 44,900 仍在小泥的暫存薪水裡`);

if (already) { console.log('\n⚠ 這筆更正已經執行過了，不再重複。'); process.exit(0); }
if (c.coins < AMOUNT) console.log(`\n⚠ 目前餘額不足 ${N(AMOUNT)}，執行後會變成負數，請先確認。`);
if (!APPLY) { console.log('\n這只是試算，沒有寫入任何資料。確認無誤後加上 --apply。'); process.exit(0); }

db.transaction(() => {
  addCoins(org, o.customer_id, -AMOUNT, `更正：月冠母單 ${ORDER} 已拆單，退單不應退幣`,
    { ref: ORDER, operator: 'system', allowNegative: true });
  db.prepare('UPDATE customers SET total_spend = total_spend + ? WHERE guild_id=? AND user_id=?')
    .run(AMOUNT, org, o.customer_id);
  db.prepare('UPDATE orders SET note = ? WHERE id = ?')
    .run(`${o.note}（更正：母單已拆單，雨幣不退）`, o.id);
})();
refreshVip(org, o.customer_id);
audit('system', '更正月冠退款', `${ORDER} 收回 ${AMOUNT}`, org, { source: 'salary' });

const after = db.prepare('SELECT coins, total_spend FROM customers WHERE guild_id=? AND user_id=?')
  .get(org, o.customer_id);
console.log(`\n已完成：雨幣 ${N(after.coins)}　累計消費 ${N(after.total_spend)}`);
