#!/usr/bin/env node
// 金流健檢：把每一種餘額拿去跟它的流水帳對，列出對不上的地方。
// 唯讀，不會改任何資料。用法：node scripts/audit-money.js
const { db } = require('../src/db');

const N = v => Number(v || 0).toLocaleString('en-US');
const line = t => console.log('\n' + t + '\n' + '─'.repeat(72));
let problems = 0;
const bad = (title, rows, fmt) => {
  if (!rows.length) { console.log(`✅ ${title}：正常`); return; }
  problems += rows.length;
  console.log(`❌ ${title}：${rows.length} 筆`);
  rows.slice(0, 15).forEach(r => console.log('   ' + fmt(r)));
  if (rows.length > 15) console.log(`   …另有 ${rows.length - 15} 筆`);
};

line('一、陪玩薪資');

bad('暫存薪水與未核銷訂單不符',
  db.prepare(`SELECT s.name, s.code, s.pending_income shown,
       COALESCE((SELECT SUM(o.staff_share) FROM orders o
                 WHERE o.guild_id=s.guild_id AND o.staff_id=s.user_id AND o.status='pending'),0) should
     FROM staff s WHERE shown != should`).all(),
  r => `${r.name}(${r.code}) 帳上 ${N(r.shown)} / 應為 ${N(r.should)}`);

bad('可提領餘額為負數',
  db.prepare('SELECT name, code, income FROM staff WHERE income < 0').all(),
  r => `${r.name}(${r.code}) ${N(r.income)}`);

bad('暫存薪水為負數',
  db.prepare('SELECT name, code, pending_income p FROM staff WHERE pending_income < 0').all(),
  r => `${r.name}(${r.code}) ${N(r.p)}`);

// 歷史入帳應該 >= 已提領總額（提領不可能超過曾經入帳的錢）
bad('已提領總額大於歷史入帳',
  db.prepare(`SELECT s.name, s.code, s.total_income,
       COALESCE((SELECT SUM(w.amount) FROM withdrawals w
                 WHERE w.guild_id=s.guild_id AND w.staff_id=s.user_id AND w.status!='rejected'),0) drawn
     FROM staff s WHERE drawn > s.total_income`).all(),
  r => `${r.name}(${r.code}) 歷史入帳 ${N(r.total_income)} / 已提領 ${N(r.drawn)}（差 ${N(r.drawn - r.total_income)}）`);

line('二、提領');

bad('提領金額不是正數',
  db.prepare('SELECT id, staff_id, amount FROM withdrawals WHERE amount <= 0').all(),
  r => `#${r.id} ${r.staff_id} ${N(r.amount)}`);

bad('提領狀態異常（非 pending/done/rejected）',
  db.prepare("SELECT id, status FROM withdrawals WHERE status NOT IN ('pending','done','rejected')").all(),
  r => `#${r.id} ${r.status}`);

bad('已完成的提領沒有完成時間',
  db.prepare("SELECT id, staff_id, amount FROM withdrawals WHERE status='done' AND (done_at IS NULL OR done_at='')").all(),
  r => `#${r.id} ${r.staff_id} ${N(r.amount)}`);

bad('提領對不到陪玩',
  db.prepare(`SELECT w.id, w.staff_id, w.amount FROM withdrawals w
     WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.guild_id=w.guild_id AND s.user_id=w.staff_id)`).all(),
  r => `#${r.id} ${r.staff_id} ${N(r.amount)}`);

line('三、訂單');

bad('淨利欄與「實收 − 抽成」不符',
  db.prepare("SELECT order_no, amount, staff_share, net FROM orders WHERE net != amount - staff_share").all(),
  r => `${r.order_no} 實收 ${N(r.amount)} − 抽成 ${N(r.staff_share)} ≠ 淨利 ${N(r.net)}`);

bad('抽成大於原價',
  db.prepare('SELECT order_no, list_price, staff_share FROM orders WHERE staff_share > list_price AND list_price > 0').all(),
  r => `${r.order_no} 原價 ${N(r.list_price)} / 抽成 ${N(r.staff_share)}`);

bad('金額為負數',
  db.prepare('SELECT order_no, amount, staff_share FROM orders WHERE amount < 0 OR staff_share < 0').all(),
  r => `${r.order_no} 實收 ${N(r.amount)} 抽成 ${N(r.staff_share)}`);

bad('訂單編號重複',
  db.prepare('SELECT order_no, COUNT(*) c FROM orders GROUP BY guild_id, order_no HAVING c > 1').all(),
  r => `${r.order_no} 出現 ${r.c} 次`);

bad('已核銷卻沒有核銷時間',
  db.prepare("SELECT order_no FROM orders WHERE status='settled' AND (settled_at IS NULL OR settled_at='')").all(),
  r => `${r.order_no}`);

bad('狀態異常（非 pending/settled/refunded）',
  db.prepare("SELECT order_no, status FROM orders WHERE status NOT IN ('pending','settled','refunded')").all(),
  r => `${r.order_no} ${r.status}`);

bad('有抽成卻對不到陪玩',
  db.prepare(`SELECT o.order_no, o.staff_id, o.staff_share FROM orders o
     WHERE o.staff_share > 0 AND o.staff_id != ''
       AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.guild_id=o.guild_id AND s.user_id=o.staff_id)`).all(),
  r => `${r.order_no} ${r.staff_id} 抽成 ${N(r.staff_share)}`);

line('四、老闆雨幣');

bad('雨幣餘額與交易流水不符',
  db.prepare(`SELECT c.name, c.user_id, c.coins,
       COALESCE((SELECT SUM(t.delta) FROM coin_tx t
                 WHERE t.guild_id=c.guild_id AND t.user_id=c.user_id),0) ledger
     FROM customers c WHERE c.coins != ledger`).all(),
  r => `${r.name || r.user_id} 餘額 ${N(r.coins)} / 流水 ${N(r.ledger)}（差 ${N(r.coins - r.ledger)}）`);

bad('雨幣餘額為負數',
  db.prepare('SELECT name, user_id, coins FROM customers WHERE coins < 0').all(),
  r => `${r.name || r.user_id} ${N(r.coins)}`);

bad('累計消費為負數',
  db.prepare('SELECT name, user_id, total_spend FROM customers WHERE total_spend < 0').all(),
  r => `${r.name || r.user_id} ${N(r.total_spend)}`);

line('五、總帳');

const o = db.prepare(`SELECT status, COUNT(*) c, COALESCE(SUM(amount),0) amt,
                        COALESCE(SUM(staff_share),0) share, COALESCE(SUM(net),0) net
                      FROM orders GROUP BY status`).all();
console.table(o.map(r => ({ 狀態: r.status, 筆數: r.c, 實收: N(r.amt), 陪玩抽成: N(r.share), 伺服器淨利: N(r.net) })));

const s = db.prepare(`SELECT COALESCE(SUM(income),0) i, COALESCE(SUM(pending_income),0) p,
                        COALESCE(SUM(total_income),0) t FROM staff`).get();
const w = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM withdrawals WHERE status!='rejected'").get().v;
console.log(`陪玩可提領合計 ${N(s.i)}　暫存薪水合計 ${N(s.p)}　歷史入帳合計 ${N(s.t)}　已提領合計 ${N(w)}`);
console.log(`老闆雨幣流通 ${N(db.prepare('SELECT COALESCE(SUM(coins),0) v FROM customers').get().v)}`);

console.log('\n' + '═'.repeat(72));
console.log(problems ? `發現 ${problems} 個需要處理的項目` : '所有檢查項目都通過');
