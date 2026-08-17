#!/usr/bin/env node
// 重算所有陪玩的「暫存薪水」，以未核銷訂單為準。
//
// 舊系統匯入時，staff 的暫存薪水是照試算表的欄位填的，並沒有跟著匯入的未核銷訂單一起算，
// 所以有些人明明有還沒核銷的單，暫存薪水卻是 0（陪玩看到的就是「薪水不見了」）。
// 這支把帳面補回訂單推導出來的正確值；之後的異動由 money.recalcPending 自動維持。
//
// 用法：node scripts/recalc-pending.js            只試算，不寫入
//       node scripts/recalc-pending.js --apply    實際更新
const { db } = require('../src/db');

const APPLY = process.argv.includes('--apply');

const rows = db.prepare(`
  SELECT s.id, s.guild_id, s.user_id, s.code, s.name, s.pending_income AS shown,
         COALESCE((SELECT SUM(o.staff_share) FROM orders o
                   WHERE o.guild_id = s.guild_id AND o.staff_id = s.user_id AND o.status = 'pending'), 0) AS should
  FROM staff s
  ORDER BY s.name`).all();

const diff = rows.filter(r => r.shown !== r.should);
if (!diff.length) {
  console.log(`全部 ${rows.length} 位陪玩的暫存薪水都與未核銷訂單相符，不需要調整。`);
  process.exit(0);
}

console.log(`共 ${rows.length} 位陪玩，其中 ${diff.length} 位需要調整：\n`);
console.log('代號'.padEnd(8) + '姓名'.padEnd(16) + '帳上'.padStart(10) + '應為'.padStart(10) + '差額'.padStart(10));
for (const r of diff) {
  console.log(String(r.code || '').padEnd(8) + String(r.name || r.user_id).padEnd(16)
    + String(r.shown).padStart(10) + String(r.should).padStart(10)
    + String(r.should - r.shown).padStart(10));
}
const up = diff.filter(r => r.should > r.shown).reduce((a, r) => a + r.should - r.shown, 0);
const down = diff.filter(r => r.should < r.shown).reduce((a, r) => a + r.shown - r.should, 0);
console.log(`\n補回 ${up}　扣除 ${down}`);

if (!APPLY) {
  console.log('\n這只是試算。確認無誤後加上 --apply 實際更新。');
  process.exit(0);
}

const upd = db.prepare('UPDATE staff SET pending_income = ? WHERE id = ?');
db.transaction(() => { for (const r of diff) upd.run(r.should, r.id); })();
db.prepare(`INSERT INTO audit_logs (guild_id, actor, action, detail, source)
            VALUES (?, 'system', '重算暫存薪水', ?, 'salary')`)
  .run(rows[0].guild_id, `${diff.length} 位，補回 ${up}、扣除 ${down}`);
console.log(`\n已更新 ${diff.length} 位陪玩的暫存薪水。`);
