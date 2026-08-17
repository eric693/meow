#!/usr/bin/env node
// 修正舊系統匯入時沒帶進來的兩個欄位（只動統計用欄位，不動任何餘額）：
//   A. 歷史入帳（total_income）：匯入時只填了「當月收益」，導致比已提領還小。
//      重建為「已提領（不含退回） + 目前可提領」＝這個人實際入過帳的總額。
//   B. 核銷時間（settled_at）：匯入的已核銷單沒有核銷時間，報表以核銷日篩選會漏掉，
//      補成該筆的建立時間。
//
// 用法：node scripts/fix-legacy-fields.js [--apply]
const { db } = require('../src/db');

const APPLY = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');

console.log('【A】重建歷史入帳\n');
const staff = db.prepare(`
  SELECT s.id, s.name, s.code, s.total_income, s.income,
         COALESCE((SELECT SUM(w.amount) FROM withdrawals w
                   WHERE w.guild_id=s.guild_id AND w.staff_id=s.user_id AND w.status!='rejected'), 0) drawn
  FROM staff s`).all()
  .map(s => ({ ...s, should: s.drawn + s.income }))
  .filter(s => s.should !== s.total_income);
console.log(`  需要調整：${staff.length} 位`);
staff.slice(0, 10).forEach(s => console.log(
  `    ${(s.name || '').padEnd(12)}(${s.code}) 帳上 ${String(N(s.total_income)).padStart(9)}`
  + ` → ${String(N(s.should)).padStart(9)}（已提領 ${N(s.drawn)} ＋ 可提領 ${N(s.income)}）`));
if (staff.length > 10) console.log(`    …另有 ${staff.length - 10} 位`);

console.log('\n【B】補核銷時間\n');
const orders = db.prepare(`SELECT COUNT(*) c FROM orders
  WHERE status='settled' AND (settled_at IS NULL OR settled_at='')`).get().c;
console.log(`  需要補的已核銷訂單：${orders} 筆（一律補成該筆的建立時間）`);

if (!APPLY) {
  console.log('\n這只是試算，沒有寫入任何資料。確認無誤後加上 --apply 實際更新。');
  process.exit(0);
}

const upd = db.prepare('UPDATE staff SET total_income = ? WHERE id = ?');
db.transaction(() => {
  for (const s of staff) upd.run(s.should, s.id);
  db.prepare(`UPDATE orders SET settled_at = created_at
              WHERE status='settled' AND (settled_at IS NULL OR settled_at='')`).run();
})();
db.prepare(`INSERT INTO audit_logs (guild_id, actor, action, detail, source)
            VALUES ('', 'system', '修正匯入欄位', ?, 'salary')`)
  .run(`重建歷史入帳 ${staff.length} 位、補核銷時間 ${orders} 筆`);
console.log(`\n已完成：重建 ${staff.length} 位的歷史入帳、補上 ${orders} 筆核銷時間。`);
