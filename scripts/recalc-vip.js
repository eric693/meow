#!/usr/bin/env node
// VIP 等級整批重算：門檻調整過之後，舊資料的 vip_level 仍停在當初的等級，
// 之後只要有任何消費異動就會被 refreshVip 悄悄改掉。這支腳本一次算清楚，
// 讓帳面等級＝現行門檻算出來的等級。鎖定等級（vip_locked）的老闆不動。
// 用法：node scripts/recalc-vip.js         → 只列出會變動的人（不寫入）
//       node scripts/recalc-vip.js --apply → 實際寫入
const { db, vipLevelFor, vipThresholds } = require('../src/db');

const apply = process.argv.includes('--apply');
const rows = db.prepare('SELECT id, guild_id, user_id, name, total_spend, vip_level FROM customers WHERE vip_locked = 0').all();
const diff = rows.map(c => ({ ...c, should: vipLevelFor(c.total_spend, c.guild_id) }))
  .filter(c => c.should !== c.vip_level);

const N = v => Number(v || 0).toLocaleString('en-US');
console.log(`門檻：${vipThresholds(rows[0]?.guild_id || '').map(N).join(' / ')}`);
console.log(`未鎖定的老闆 ${rows.length} 位，等級需要調整的 ${diff.length} 位\n`);
for (const c of diff.sort((a, b) => b.total_spend - a.total_spend)) {
  console.log(`${c.vip_level > c.should ? '↓' : '↑'} ${(c.name || c.user_id).padEnd(24)}`
    + ` 消費 ${N(c.total_spend).padStart(9)}　Lv${c.vip_level} → Lv${c.should}`);
}
if (!apply) return console.log('\n（試算模式，未寫入。確定要套用請加 --apply）');

const up = db.prepare('UPDATE customers SET vip_level = ? WHERE id = ?');
db.transaction(() => diff.forEach(c => up.run(c.should, c.id)))();
console.log(`\n✅ 已更新 ${diff.length} 位（降級 ${diff.filter(c => c.should < c.vip_level).length}`
  + `／升級 ${diff.filter(c => c.should > c.vip_level).length}）`);
