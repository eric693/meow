#!/usr/bin/env node
// 舊系統匯入時，每位老闆被建成兩筆客戶資料：
//   1) name:xxx —— 匯入當下把歷史消費總額整包寫進 total_spend，但底下一筆訂單也沒有
//   2) Discord ID —— 同一批歷史訂單逐筆掛在這裡，total_spend 由訂單累加而來
// 也就是說同一筆消費被記了兩次，兩邊金額才會一模一樣（例：wdali 10,880 + 10,880）。
// 真正有效的是 ID 帳號，name: 那筆是空殼：沒有訂單、沒有雨幣、沒有背包與羈絆。
// 這支腳本只清掉「完全沒有任何關聯資料」的空殼，有訂單的 name: 帳號一律保留。
// 用法：node scripts/merge-legacy-customers.js         → 只列出來（不寫入）
//       node scripts/merge-legacy-customers.js --apply → 實際刪除
const { db } = require('../src/db');

const apply = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');
const cnt = (sql, id) => db.prepare(sql).get(id).c;

const legacy = db.prepare("SELECT * FROM customers WHERE user_id LIKE 'name:%'").all();
const ghosts = [], keep = [];
for (const c of legacy) {
  const rel = cnt('SELECT COUNT(*) c FROM orders WHERE customer_id=?', c.user_id)
    + cnt('SELECT COUNT(*) c FROM coin_tx WHERE user_id=?', c.user_id)
    + cnt('SELECT COUNT(*) c FROM gift_logs WHERE customer_id=?', c.user_id)
    + cnt('SELECT COUNT(*) c FROM backpack WHERE user_id=?', c.user_id);
  // 對得到的 Discord ID 帳號（同名訂單掛在誰身上）
  const ids = db.prepare(`SELECT DISTINCT customer_id id FROM orders
      WHERE customer_name=? AND customer_id NOT LIKE 'name:%' AND customer_id<>''`).all(c.name).map(r => r.id);
  (rel === 0 && c.coins === 0 && ids.length ? ghosts : keep).push({ ...c, ids });
}

console.log(`name: 開頭的匯入帳號共 ${legacy.length} 筆`);
console.log(`可清除的空殼 ${ghosts.length} 筆（無訂單／雨幣／背包，且對得到本人的 Discord 帳號）`);
console.log(`保留 ${keep.length} 筆（底下真的有資料，或找不到對應的 Discord 帳號）\n`);
for (const g of ghosts.sort((a, b) => b.total_spend - a.total_spend).slice(0, 15)) {
  const real = db.prepare('SELECT total_spend, vip_level FROM customers WHERE guild_id=? AND user_id=?')
    .get(g.guild_id, g.ids[0]);
  console.log(`  ${g.name.padEnd(24)} 空殼掛帳 ${N(g.total_spend).padStart(8)}`
    + `　→ 本人帳號實際消費 ${N(real?.total_spend).padStart(8)}（Lv${real?.vip_level}）`);
}
if (ghosts.length > 15) console.log(`  …另有 ${ghosts.length - 15} 筆`);
for (const k of keep) console.log(`  [保留] ${k.name || k.user_id} 消費 ${N(k.total_spend)}`);

if (!apply) return console.log('\n（試算模式，未寫入。確定要清除請加 --apply）');
db.transaction(() => ghosts.forEach(g => db.prepare('DELETE FROM customers WHERE id=?').run(g.id)))();
console.log(`\n✅ 已清除 ${ghosts.length} 筆空殼帳號。請接著跑 node scripts/recalc-vip.js 確認等級。`);
