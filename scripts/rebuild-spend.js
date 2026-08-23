#!/usr/bin/env node
// 老闆資料整理：把舊系統匯入留下的重複帳號併回本人，再以流水為準重建累計消費與 VIP 等級。
//
// 匯入留下的三個病灶：
//  1) name:xxx 空殼帳號（127 筆）：把歷史消費整包寫進 total_spend，底下一筆訂單也沒有，
//     那些錢在本人的 Discord 帳號上已經逐筆記過一次，等於同一筆消費被算了兩遍。
//  2) name:xxx 真帳號（10 筆）：訂單掛在名字上，扣雨幣的卻是本人的 Discord 帳號，
//     一個人被拆成兩半。對應關係用「訂單編號出現在誰的扣款流水裡」認得出來，一對一乾淨。
//  3) 舊系統的下單／送禮扣款有些沒有對應訂單，只看訂單會把這些人算成幾乎沒消費過。
//
// 重建後：累計消費 =（本人名下未退單訂單的實收金額）＋（對不到訂單的下單／送禮扣款）。
// 提領薪水、人工扣款、帳務更正也是負的雨幣，但那不是消費，一律不算——身兼陪玩的老闆
// 提領一筆 5 萬要是算進去，就會平白多一個 VIP 等級。註記「已取消」的送禮同樣不算。
// VIP 等級再依現行門檻重算；鎖定等級（vip_locked）的老闆只重建金額，等級照指定不動。
//
// 用法：node scripts/rebuild-spend.js         → 只列出會變動的（不寫入）
//       node scripts/rebuild-spend.js --apply → 實際寫入
const { db, vipLevelFor } = require('../src/db');

const apply = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');
const cnt = (sql, id) => db.prepare(sql).get(id).c;

// ---- 1) 匯入帳號分類：能併回本人的、以及純空殼的 ----
const legacy = db.prepare("SELECT * FROM customers WHERE user_id LIKE 'name:%'").all();
const merges = [], ghosts = [], orphanAccounts = [];
for (const c of legacy) {
  const orders = db.prepare('SELECT order_no FROM orders WHERE customer_id=?').all(c.user_id);
  if (orders.length) {
    // 訂單掛在名字上：看這些訂單的雨幣是從誰的帳戶扣的，那個人就是本人
    const owners = {};
    for (const o of orders) {
      for (const t of db.prepare('SELECT user_id FROM coin_tx WHERE ref=? AND delta<0').all(o.order_no)) {
        owners[t.user_id] = (owners[t.user_id] || 0) + 1;
      }
    }
    const ids = Object.keys(owners);
    if (ids.length === 1) merges.push({ ...c, to: ids[0], orders: orders.length });
    else orphanAccounts.push({ ...c, reason: ids.length ? '對到多個帳號：' + ids.join('/') : '找不到對應的扣款帳號' });
    continue;
  }
  const rel = cnt('SELECT COUNT(*) c FROM coin_tx WHERE user_id=?', c.user_id)
    + cnt('SELECT COUNT(*) c FROM gift_logs WHERE customer_id=?', c.user_id)
    + cnt('SELECT COUNT(*) c FROM backpack WHERE user_id=?', c.user_id);
  const hasReal = db.prepare(`SELECT COUNT(*) c FROM orders
      WHERE customer_name=? AND customer_id NOT LIKE 'name:%' AND customer_id<>''`).get(c.name).c > 0;
  if (rel === 0 && c.coins === 0 && hasReal) ghosts.push(c);
  else orphanAccounts.push({ ...c, reason: '沒有訂單但有其他資料或對不到本人，保留不動' });
}

console.log(`匯入帳號 ${legacy.length} 筆：併回本人 ${merges.length}、刪除空殼 ${ghosts.length}、保留 ${orphanAccounts.length}\n`);
for (const m of merges) console.log(`  併回 ${m.name.padEnd(34)} ${m.orders} 筆訂單 → ${m.to}`);
for (const o of orphanAccounts) console.log(`  保留 ${o.name || o.user_id}（${o.reason}）`);

// ---- 2) 依流水重建累計消費與等級（試算時把併帳結果一起算進去）----
const remap = new Map(merges.map(m => [m.user_id, m.to]));
const dropIds = new Set([...ghosts, ...merges].map(c => c.id));
const rows = db.prepare('SELECT * FROM customers').all().filter(c => !dropIds.has(c.id));
const changes = [];
for (const c of rows) {
  const ids = [c.user_id, ...[...remap].filter(([, to]) => to === c.user_id).map(([from]) => from)];
  const ph = ids.map(() => '?').join(',');
  const spend = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM orders
      WHERE guild_id=? AND customer_id IN (${ph}) AND status<>'refunded'`).get(c.guild_id, ...ids).s
    + db.prepare(`SELECT COALESCE(SUM(-t.delta),0) s FROM coin_tx t
      WHERE t.guild_id=? AND t.user_id IN (${ph}) AND t.delta<0
        AND (t.reason LIKE '下單%' OR t.reason LIKE '送禮%') AND t.reason NOT LIKE '%已取消%'
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_no=t.ref)`).get(c.guild_id, ...ids).s;
  const total = Math.max(0, spend);
  const lv = c.vip_locked ? c.vip_level : vipLevelFor(total, c.guild_id);
  if (total !== c.total_spend || lv !== c.vip_level) changes.push({ ...c, spend: total, lv });
}

const up = changes.filter(c => c.lv > c.vip_level), dn = changes.filter(c => c.lv < c.vip_level);
console.log(`\n累計消費有變動：${changes.filter(c => c.spend !== c.total_spend).length} 位`
  + `（合計 ${N(changes.reduce((t, c) => t + (c.spend - c.total_spend), 0))}）`);
console.log(`VIP 等級變動：升級 ${up.length} 位、降級 ${dn.length} 位\n`);
for (const c of [...up, ...dn].sort((a, b) => b.spend - a.spend)) {
  console.log(`${c.lv > c.vip_level ? '↑' : '↓'} ${(c.name || c.user_id).padEnd(24)}`
    + ` 消費 ${N(c.total_spend).padStart(9)} → ${N(c.spend).padStart(9)}　Lv${c.vip_level} → Lv${c.lv}`);
}

if (!apply) return console.log('\n（試算模式，未寫入。確定要套用請加 --apply）');
db.transaction(() => {
  for (const m of merges) {
    const to = db.prepare('SELECT * FROM customers WHERE guild_id=? AND user_id=?').get(m.guild_id, m.to);
    db.prepare('UPDATE orders SET customer_id=?, customer_name=? WHERE customer_id=?')
      .run(m.to, to?.name || m.name, m.user_id);
    db.prepare('UPDATE gift_logs SET customer_id=? WHERE customer_id=?').run(m.to, m.user_id);
    // 本人帳號沒填名字時，把舊帳號的名字帶過去，後台才看得出是誰
    if (to && !to.name) db.prepare('UPDATE customers SET name=? WHERE id=?').run(m.name, to.id);
    db.prepare('DELETE FROM customers WHERE id=?').run(m.id);
  }
  ghosts.forEach(g => db.prepare('DELETE FROM customers WHERE id=?').run(g.id));
  changes.forEach(c => db.prepare('UPDATE customers SET total_spend=?, vip_level=? WHERE id=?')
    .run(c.spend, c.lv, c.id));
})();
console.log(`\n✅ 併回 ${merges.length} 筆、刪除空殼 ${ghosts.length} 筆、重建 ${changes.length} 位的消費與等級。`);
