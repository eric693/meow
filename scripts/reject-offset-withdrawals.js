#!/usr/bin/env node
// 把「用來沖銷誤核銷」的提領退回，錢還給陪玩。
//
// 8/17 傍晚有人用後台「建立提領」＋備註「退單」的方式想收回誤核銷多發的薪水，
// 但那會直接扣可提領餘額、金額又跟誤核銷金額不一致，訂單狀態也沒改，帳因此對不起來。
// 正確做法是回滾誤核銷的訂單，所以這批提領要先退回。
//
// 退回＝withdrawals 標成 rejected，金額加回 staff.income（走既有的 reviewWithdraw 邏輯）。
//
// 用法：node scripts/reject-offset-withdrawals.js [--since '2026-08-17 20:00'] [--apply]
const { db } = require('../src/db');
const M = require('../src/util/money');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const i = args.indexOf('--since');
const SINCE = i >= 0 ? args[i + 1] : '2026-08-17 20:00';
const N = v => Number(v || 0).toLocaleString('en-US');

const rows = db.prepare(`
  SELECT w.*, (SELECT name FROM staff s WHERE s.guild_id=w.guild_id AND s.user_id=w.staff_id) name,
         (SELECT income FROM staff s WHERE s.guild_id=w.guild_id AND s.user_id=w.staff_id) income
  FROM withdrawals w WHERE w.status='pending' AND w.created_at >= ? ORDER BY w.id`).all(SINCE);

if (!rows.length) { console.log(`${SINCE} 之後沒有待審核的提領，不需要處理。`); process.exit(0); }

console.log(`${SINCE} 之後待審核的提領：${rows.length} 筆\n`);
console.log('  #    姓名'.padEnd(22) + '退回金額'.padStart(10) + '　可提領 現在 → 退回後');
for (const r of rows) {
  console.log(`  ${String(r.id).padEnd(5)}${String(r.name || r.staff_id).padEnd(14)}`
    + String(N(r.amount)).padStart(10) + `　${String(N(r.income)).padStart(8)} → ${N(r.income + r.amount)}`);
}
console.log(`\n合計退回 ${N(rows.reduce((a, r) => a + r.amount, 0))} 元給 ${new Set(rows.map(r => r.staff_id)).size} 位陪玩`);

// 已經按下「完成」的沒辦法用同一條路退回（錢已視為發出），單獨列出來讓人工處理
const done = db.prepare(`SELECT w.id, w.amount, w.done_at,
    (SELECT name FROM staff s WHERE s.user_id=w.staff_id) name
  FROM withdrawals w WHERE w.status='done' AND w.created_at >= ? ORDER BY w.id`).all(SINCE);
if (done.length) {
  console.log(`\n⚠ 另有 ${done.length} 筆已按「完成發放」，這支腳本不會動它們（需人工確認是否真的付款）：`);
  done.forEach(d => console.log(`   #${d.id} ${d.name} ${N(d.amount)}（完成於 ${d.done_at}）`));
}

if (!APPLY) {
  console.log('\n這只是試算，沒有寫入任何資料。確認無誤後加上 --apply 實際退回。');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const r of rows) {
  try { M.reviewWithdraw(r.guild_id, r.id, 'rejected', 'system：沖銷用提領退回'); ok++; }
  catch (e) { fail++; console.error(`  #${r.id} 退回失敗：${e.message}`); }
}
console.log(`\n已退回 ${ok} 筆${fail ? `，${fail} 筆失敗` : ''}。`);
