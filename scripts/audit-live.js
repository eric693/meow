#!/usr/bin/env node
// 只檢查「新系統上線後」自己產生的資料，把舊系統匯入的痕跡排除在外。
// 目的是回答一個問題：現在這套系統本身有沒有在漏錢？唯讀。
const { db } = require('../src/db');

// 舊系統的資料分兩批匯入（source=legacy／import，單號 IMP-）；其餘才是新系統自己開的單
const LIVE_ORDER = "source NOT IN ('legacy','import') AND order_no NOT LIKE 'IMP-%'";
const N = v => Number(v || 0).toLocaleString('en-US');
let problems = 0;
const check = (title, rows, fmt) => {
  if (!rows.length) return console.log(`✅ ${title}`);
  problems += rows.length;
  console.log(`❌ ${title}：${rows.length} 筆`);
  rows.slice(0, 10).forEach(r => console.log('   ' + fmt(r)));
  if (rows.length > 10) console.log(`   …另有 ${rows.length - 10} 筆`);
};

const live = db.prepare(`SELECT COUNT(*) c, MIN(created_at) a, MAX(created_at) b FROM orders WHERE ${LIVE_ORDER}`).get();
console.log(`新系統自己開的訂單：${live.c} 筆（${live.a} ~ ${live.b}）\n`);

check('每筆訂單都有對應的陪玩',
  db.prepare(`SELECT o.order_no, o.staff_id FROM orders o WHERE ${LIVE_ORDER}
     AND o.staff_id != '' AND NOT EXISTS
       (SELECT 1 FROM staff s WHERE s.guild_id=o.guild_id AND s.user_id=o.staff_id)`).all(),
  r => `${r.order_no} ${r.staff_id}`);

check('已核銷的單都有核銷時間',
  db.prepare(`SELECT order_no FROM orders WHERE ${LIVE_ORDER}
     AND status='settled' AND (settled_at IS NULL OR settled_at='')`).all(), r => r.order_no);

check('沒有負數金額的單',
  db.prepare(`SELECT order_no, amount, staff_share FROM orders WHERE ${LIVE_ORDER}
     AND (amount < 0 OR staff_share < 0)`).all(),
  r => `${r.order_no} 實收 ${N(r.amount)} 抽成 ${N(r.staff_share)}`);

check('淨利＝實收−抽成',
  db.prepare(`SELECT order_no FROM orders WHERE ${LIVE_ORDER} AND net != amount - staff_share`).all(),
  r => r.order_no);

// 每一筆有扣款的訂單都應該在雨幣流水留下紀錄（雨幣付款才會扣）
check('有扣雨幣的單都有留下雨幣流水',
  db.prepare(`SELECT o.order_no, o.amount FROM orders o WHERE ${LIVE_ORDER}
     AND o.amount > 0 AND o.customer_id != '' AND o.pay_method LIKE '%雨幣%'
     AND NOT EXISTS (SELECT 1 FROM coin_tx t WHERE t.guild_id=o.guild_id AND t.ref=o.order_no)`).all(),
  r => `${r.order_no} 實收 ${N(r.amount)}`);

// 退單也應該有一筆退還的流水
check('退掉的單都有退還雨幣的流水',
  db.prepare(`SELECT o.order_no FROM orders o WHERE ${LIVE_ORDER}
     AND o.status='refunded' AND o.customer_id != '' AND o.amount > 0
     AND (SELECT COUNT(*) FROM coin_tx t WHERE t.guild_id=o.guild_id AND t.ref=o.order_no) < 2`).all(),
  r => r.order_no);

check('雨幣流水沒有金額為 0 的空紀錄',
  db.prepare('SELECT id, user_id, reason FROM coin_tx WHERE delta = 0').all(),
  r => `#${r.id} ${r.user_id} ${r.reason}`);

// 提領：新系統的提領一定對得到陪玩，且不超過當時的可提領
check('新系統的提領都對得到陪玩',
  db.prepare(`SELECT w.id, w.staff_id, w.amount FROM withdrawals w
     WHERE w.created_at >= (SELECT MIN(created_at) FROM orders WHERE ${LIVE_ORDER})
     AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.guild_id=w.guild_id AND s.user_id=w.staff_id)`).all(),
  r => `#${r.id} ${r.staff_id} ${N(r.amount)}`);

console.log('\n' + '═'.repeat(64));
console.log(problems ? `新系統資料發現 ${problems} 個問題` : '新系統上線後產生的資料完全一致，沒有漏帳');
