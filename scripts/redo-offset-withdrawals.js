#!/usr/bin/env node
// 還原「沖銷用提領」的扣款：把被誤退回的提領改回待審核，並重新從可提領扣除。
//
// 這是 reject-offset-withdrawals.js 的反向操作。承辦人是刻意用提領把多餘的錢一筆一筆扣掉，
// 先前誤把它們當成錯誤操作退回，這支負責把狀態與餘額還原。
//
// 用法：node scripts/redo-offset-withdrawals.js [--apply]
const { db, audit } = require('../src/db');

const APPLY = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');

// 只找「被這支系統退回的」那批，避免動到承辦人自己退回的紀錄
const rows = db.prepare(`
  SELECT w.*, (SELECT name FROM staff s WHERE s.guild_id=w.guild_id AND s.user_id=w.staff_id) name,
         (SELECT income FROM staff s WHERE s.guild_id=w.guild_id AND s.user_id=w.staff_id) income
  FROM withdrawals w
  WHERE w.status='rejected' AND w.operator LIKE 'system：沖銷用提領退回%'
  ORDER BY w.id`).all();

if (!rows.length) { console.log('沒有需要還原的提領。'); process.exit(0); }

console.log(`要還原的提領：${rows.length} 筆\n`);
console.log('  #    姓名'.padEnd(22) + '扣回金額'.padStart(10) + '　可提領 現在 → 扣回後');
let short = 0;
for (const r of rows) {
  const after = r.income - r.amount;
  if (after < 0) short++;
  console.log(`  ${String(r.id).padEnd(5)}${String(r.name || r.staff_id).padEnd(14)}`
    + String(N(r.amount)).padStart(10) + `　${String(N(r.income)).padStart(8)} → ${N(after)}`
    + (after < 0 ? '　⚠ 餘額不足' : ''));
}
console.log(`\n合計扣回 ${N(rows.reduce((a, r) => a + r.amount, 0))} 元`);
if (short) console.log(`⚠ 其中 ${short} 位扣回後會變負數，這幾筆不會處理，請個別確認。`);

if (!APPLY) {
  console.log('\n這只是試算，沒有寫入任何資料。確認無誤後加上 --apply 實際還原。');
  process.exit(0);
}

let ok = 0, skip = 0;
const upd = db.prepare(`UPDATE withdrawals SET status='pending', done_at=NULL, operator=? WHERE id=?`);
const ded = db.prepare('UPDATE staff SET income = income - ? WHERE guild_id=? AND user_id=?');
db.transaction(() => {
  for (const r of rows) {
    if (r.income - r.amount < 0) { skip++; continue; }
    // 還原成承辦人當初建立時的狀態：待審核、經手人記回原本的操作者
    upd.run('總管理員', r.id);
    ded.run(r.amount, r.guild_id, r.staff_id);
    ok++;
  }
})();
audit('system', '還原沖銷用提領', `${ok} 筆重新扣除${skip ? `，${skip} 筆因餘額不足略過` : ''}`,
  rows[0].guild_id, { source: 'salary' });
console.log(`\n已還原 ${ok} 筆${skip ? `，${skip} 筆略過` : ''}。`);
