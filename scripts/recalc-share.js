#!/usr/bin/env node
// 折扣由伺服器吸收：把舊訂單的陪玩抽成補算成「以原價計算」
// 用法：node scripts/recalc-share.js [--guild <id>] [--from YYYY-MM] [--to YYYY-MM] [--apply]
//   不加 --apply 只試算。已退單（refunded）的訂單不補。
const { db, orgOf } = require('../src/db');
const M = require('../src/util/money');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (k, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const GUILD = orgOf(arg('--guild', '1535904785084059718'));
const FROM = arg('--from', '0000-00');
const TO = arg('--to', '9999-99');

const rate = M.shareRate(GUILD);
const rows = db.prepare(`SELECT * FROM orders
   WHERE guild_id=? AND status != 'refunded' AND list_price > amount
     AND substr(created_at,1,7) >= ? AND substr(created_at,1,7) <= ?
   ORDER BY created_at`).all(GUILD, FROM, TO);

const plan = [];
for (const o of rows) {
  if (!o.staff_id || o.staff_id.startsWith('name:')) continue;   // 對不到人的舊單跳過
  const want = Math.round(o.list_price * rate / 100);
  const diff = want - o.staff_share;
  if (diff <= 0) continue;
  plan.push({ o, want, diff });
}

const byStaff = new Map();
for (const p of plan) {
  const k = p.o.staff_id;
  const cur = byStaff.get(k) || { name: p.o.staff_name || k, settled: 0, pending: 0, cnt: 0 };
  cur[p.o.status === 'settled' ? 'settled' : 'pending'] += p.diff;
  cur.cnt++;
  byStaff.set(k, cur);
}

const total = plan.reduce((a, p) => a + p.diff, 0);
const skipped = rows.length - plan.length;

if (APPLY) {
  db.transaction(() => {
    for (const p of plan) {
      db.prepare('UPDATE orders SET staff_share=?, net=amount-? WHERE id=?').run(p.want, p.want, p.o.id);
    }
    for (const [id, v] of byStaff) {
      // 已核銷的補進可提領與歷史累計，未核銷的補進暫存薪水
      if (v.settled) db.prepare(`UPDATE staff SET income = income + ?, total_income = total_income + ?
                                 WHERE guild_id=? AND user_id=?`).run(v.settled, v.settled, GUILD, id);
      if (v.pending) db.prepare('UPDATE staff SET pending_income = pending_income + ? WHERE guild_id=? AND user_id=?')
        .run(v.pending, GUILD, id);
    }
  })();
}

console.log(`${APPLY ? '✅ 已寫入' : '🔍 試算（未寫入，加 --apply 才會寫）'}　抽成率 ${rate}%　範圍 ${FROM}～${TO}`);
console.log(` - 有折扣的訂單 ${rows.length} 筆，實際補算 ${plan.length} 筆（陪玩對不到人或已達原價抽成的 ${skipped} 筆跳過）`);
console.log(` - 補發總額 ${total.toLocaleString('en-US')}（可提領 ${[...byStaff.values()].reduce((a, v) => a + v.settled, 0).toLocaleString('en-US')}`
  + `／暫存薪水 ${[...byStaff.values()].reduce((a, v) => a + v.pending, 0).toLocaleString('en-US')}）`);
console.log(` - 影響 ${byStaff.size} 位陪玩，補最多的前 5 位：`);
[...byStaff.entries()].sort((a, b) => (b[1].settled + b[1].pending) - (a[1].settled + a[1].pending)).slice(0, 5)
  .forEach(([, v]) => console.log(`   ${v.name}：${(v.settled + v.pending).toLocaleString('en-US')}（${v.cnt} 筆）`));
