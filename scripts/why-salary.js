#!/usr/bin/env node
// 追查某位陪玩的薪資：把餘額拆成一筆一筆的異動，看數字是怎麼變成現在這樣的。
// 陪玩反映「餘額跟我記得的不一樣」時，用這支對帳最快。唯讀。
//
// 用法：node scripts/why-salary.js 小泥
//       node scripts/why-salary.js 1018081568763420714
//       node scripts/why-salary.js 小泥 --days 30      只看最近 30 天
const { db } = require('../src/db');

const args = process.argv.slice(2);
const key = args.find(a => !a.startsWith('--'));
const days = Number((args[args.indexOf('--days') + 1] || 0)) || 0;
if (!key) { console.error('請指定陪玩的名稱、代號或 Discord ID'); process.exit(1); }

const N = v => Number(v || 0).toLocaleString('en-US');
const staff = db.prepare(`SELECT * FROM staff WHERE user_id = ? OR name = ? OR code = ?`).all(key, key, key);
if (!staff.length) { console.error(`查無「${key}」`); process.exit(1); }
if (staff.length > 1) console.log(`⚠ 找到 ${staff.length} 筆同名資料，以下逐一列出\n`);

for (const s of staff) {
  console.log('═'.repeat(74));
  console.log(`${s.name}（代號 ${s.code}／${s.user_id}）　集團 ${s.guild_id}　${s.active ? '在職' : '已離職'}`);
  console.log(`目前：可提領 ${N(s.income)}　暫存薪水 ${N(s.pending_income)}　歷史入帳 ${N(s.total_income)}`);

  const since = days ? `AND date(x) >= date('now','localtime','-${days} days')` : '';
  // 把「訂單核銷（＋）」與「提領（−）」放在同一條時間軸上，就看得出每一步怎麼變
  const rows = db.prepare(`
    SELECT settled_at x, '核銷入帳' kind, order_no ref, staff_share amt, item note
      FROM orders WHERE guild_id=? AND staff_id=? AND status='settled' AND settled_at IS NOT NULL
      ${since.replace(/x/g, 'settled_at')}
    UNION ALL
    SELECT created_at x, '退單扣回' kind, order_no ref, -staff_share amt, note
      FROM orders WHERE guild_id=? AND staff_id=? AND status='refunded'
      ${since.replace(/x/g, 'created_at')}
    UNION ALL
    SELECT COALESCE(done_at, created_at) x, CASE status WHEN 'rejected' THEN '提領退回' ELSE '提領' END kind,
           'WD#' || id, CASE status WHEN 'rejected' THEN amount ELSE -amount END, note
      FROM withdrawals WHERE guild_id=? AND staff_id=?
      ${since.replace(/x/g, 'COALESCE(done_at, created_at)')}
    ORDER BY x DESC LIMIT 40`)
    .all(s.guild_id, s.user_id, s.guild_id, s.user_id, s.guild_id, s.user_id);

  console.log(`\n最近 ${rows.length} 筆異動（新→舊）：`);
  console.log('  時間'.padEnd(23) + '項目'.padEnd(10) + '金額'.padStart(10) + '  單號／備註');
  for (const r of rows) {
    console.log('  ' + String(r.x || '').padEnd(21) + String(r.kind).padEnd(10)
      + String(N(r.amt)).padStart(10) + '  ' + String(r.ref).padEnd(16) + String(r.note || '').slice(0, 24));
  }

  const settled = db.prepare(`SELECT COALESCE(SUM(staff_share),0) v FROM orders
                              WHERE guild_id=? AND staff_id=? AND status='settled'`).get(s.guild_id, s.user_id).v;
  const pending = db.prepare(`SELECT COALESCE(SUM(staff_share),0) v FROM orders
                              WHERE guild_id=? AND staff_id=? AND status='pending'`).get(s.guild_id, s.user_id).v;
  const drawn = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM withdrawals
                            WHERE guild_id=? AND staff_id=? AND status!='rejected'`).get(s.guild_id, s.user_id).v;
  console.log('\n對帳：');
  console.log(`  系統內核銷入帳合計 ${N(settled)} − 已提領 ${N(drawn)} = ${N(settled - drawn)}`);
  console.log(`  目前可提領 ${N(s.income)}　→ 差額 ${N(s.income - (settled - drawn))}`);
  console.log('  （差額多半來自舊系統轉入的餘額，那部分在這套系統裡沒有對應的訂單）');
  console.log(`  暫存薪水 ${N(s.pending_income)}　未核銷訂單合計 ${N(pending)}`
    + `　${s.pending_income === pending ? '✅ 相符' : '❌ 不符'}`);
}
