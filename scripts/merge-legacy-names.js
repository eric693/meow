#!/usr/bin/env node
// 把舊資料留下的 name:xxx 暫用帳，換成真實 Discord ID
// 用法：node scripts/merge-legacy-names.js <users.json> [--guild <id>] [--apply]
//   users.json = { "<discord id>": { "u": "帳號", "g": "顯示名稱" }, ... }
const fs = require('fs');
const { db } = require('../src/db');

const args = process.argv.slice(2);
const mapFile = args.find(a => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const GUILD = (() => { const i = args.indexOf('--guild'); return i >= 0 ? args[i + 1] : '1535904785084059718'; })();

const users = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const byName = new Map();
for (const [id, v] of Object.entries(users)) for (const k of [v.u, v.g]) if (k) byName.set(String(k).toLowerCase(), id);
const real = ph => byName.get(ph.slice(5).toLowerCase()) || null;

const stats = [];
const run = db.transaction(() => {
  // --- staff：有真人帳號就把暫用帳併掉，沒有就直接換 ID
  const ph = db.prepare("SELECT * FROM staff WHERE guild_id=? AND user_id LIKE 'name:%'").all(GUILD);
  let relinked = 0, dropped = 0, unmatched = 0;
  for (const s of ph) {
    const id = real(s.user_id);
    if (!id) { unmatched++; continue; }
    const cur = db.prepare('SELECT * FROM staff WHERE guild_id=? AND user_id=?').get(GUILD, id);
    if (cur) {
      // 真帳號已存在（playmates 匯入那批），收益以真帳號為準，暫用帳直接刪掉
      if (!cur.card_url && s.card_url) db.prepare('UPDATE staff SET card_url=? WHERE id=?').run(s.card_url, cur.id);
      db.prepare('DELETE FROM staff WHERE id=?').run(s.id);
      dropped++;
    } else {
      db.prepare('UPDATE staff SET user_id=? WHERE id=?').run(id, s.id);
      relinked++;
    }
  }
  stats.push(`陪玩 staff：換成真實 ID ${relinked} 筆、併掉重複的暫用帳 ${dropped} 筆、對不到人的留著 ${unmatched} 筆`);

  // --- 其他表的 name:xxx 參照
  const swap = (table, col) => {
    const names = db.prepare(`SELECT DISTINCT ${col} v FROM ${table} WHERE guild_id=? AND ${col} LIKE 'name:%'`).all(GUILD).map(r => r.v);
    let rows = 0, miss = 0;
    for (const n of names) {
      const id = real(n);
      if (!id) { miss++; continue; }
      rows += db.prepare(`UPDATE ${table} SET ${col}=? WHERE guild_id=? AND ${col}=?`).run(id, GUILD, n).changes;
    }
    stats.push(`${table}.${col}：更新 ${rows} 列，仍有 ${miss} 個名稱對不到人`);
  };
  swap('orders', 'customer_id');
  swap('orders', 'staff_id');
  // intimacy 有 (guild, customer, staff) 主鍵，換 ID 可能撞到既有列，撞到就把積分加總
  for (const col of ['customer_id', 'staff_id']) {
    const rows = db.prepare(`SELECT * FROM intimacy WHERE guild_id=? AND ${col} LIKE 'name:%'`).all(GUILD);
    let moved = 0, merged = 0, miss = 0;
    for (const r of rows) {
      const id = real(r[col]);
      if (!id) { miss++; continue; }
      const cust = col === 'customer_id' ? id : r.customer_id;
      const staff = col === 'staff_id' ? id : r.staff_id;
      const hit = db.prepare('SELECT points FROM intimacy WHERE guild_id=? AND customer_id=? AND staff_id=?').get(GUILD, cust, staff);
      db.prepare('DELETE FROM intimacy WHERE guild_id=? AND customer_id=? AND staff_id=?').run(GUILD, r.customer_id, r.staff_id);
      db.prepare(`INSERT INTO intimacy (guild_id, customer_id, staff_id, points) VALUES (?,?,?,?)
                  ON CONFLICT(guild_id, customer_id, staff_id) DO UPDATE SET points = points + excluded.points`)
        .run(GUILD, cust, staff, r.points);
      hit ? merged++ : moved++;
    }
    stats.push(`intimacy.${col}：搬移 ${moved} 列、與既有紀錄合併 ${merged} 列，對不到 ${miss} 列`);
  }
  swap('coin_tx', 'user_id');

  if (!APPLY) throw new Error('DRY_RUN');
});

try { run(); } catch (e) { if (e.message !== 'DRY_RUN') throw e; }
console.log(APPLY ? '✅ 已寫入' : '🔍 試算（未寫入，加 --apply 才會寫）');
stats.forEach(s => console.log(' - ' + s));
