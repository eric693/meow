#!/usr/bin/env node
// 修「已提領總額大於歷史入帳」。
//
// 歷史入帳（total_income）是累計統計欄位，恆等式是：
//   歷史入帳 = 已提領（不含駁回）＋ 目前可提領
// 早期重跑 import-legacy.js 會直接覆蓋 staff 的餘額欄位（現在要加
// --overwrite-balance 才會覆蓋），把匯入後新核銷的入帳一起抹掉，
// 少數人的 total_income 就比實際領走的還小。
//
// 這支只修 total_income，不動可提領與雨幣——沒有人的錢會變多或變少，
// 領不出來的錢也不會因此領得出來。
// 用法：node scripts/fix-total-income.js          → 試算
//       node scripts/fix-total-income.js --apply  → 寫入
const { db, audit } = require('../src/db');

const apply = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');

const rows = db.prepare(`SELECT s.id, s.guild_id, s.user_id, s.name, s.code, s.total_income, s.income,
    COALESCE((SELECT SUM(w.amount) FROM withdrawals w
      WHERE w.guild_id=s.guild_id AND w.staff_id=s.user_id AND w.status!='rejected'),0) drawn
  FROM staff s`).all()
  .map(r => ({ ...r, should: r.drawn + r.income }))
  .filter(r => r.should !== r.total_income);

if (!rows.length) { console.log('✅ 所有陪玩的歷史入帳都對得起來，不需要修正'); process.exit(0); }

const up = rows.filter(r => r.should > r.total_income);
const down = rows.filter(r => r.should < r.total_income);
console.log(`需要修正 ${rows.length} 位：調高 ${up.length} 位、調低 ${down.length} 位\n`);
for (const r of rows) {
  console.log(`  ${String(r.name || r.user_id).padEnd(14)} ${String(N(r.total_income)).padStart(9)} → ${String(N(r.should)).padStart(9)}`
    + `　（已提領 ${N(r.drawn)} ＋ 可提領 ${N(r.income)}）`);
}
console.log(`\n合計調整 ${N(rows.reduce((a, r) => a + (r.should - r.total_income), 0))}`);

if (down.length) {
  console.log('\n⚠️  有人的帳上數字比「已提領＋可提領」還高。這不是匯入覆蓋造成的，');
  console.log('    可能有退單或人工調整沒走到這條路，請先查清楚再套用。');
}
if (!apply) { console.log('\n（試算模式，未寫入。確定要套用請加 --apply）'); process.exit(0); }

const stmt = db.prepare('UPDATE staff SET total_income=? WHERE id=?');
db.transaction(() => { for (const r of rows) stmt.run(r.should, r.id); })();
audit('系統維護', '修正歷史入帳', `${rows.length} 位`, rows[0].guild_id, { source: 'script' });
console.log(`\n✅ 已修正 ${rows.length} 位陪玩的歷史入帳（可提領與雨幣未變動）`);
