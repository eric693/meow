#!/usr/bin/env node
// 收回「憑空生出來的雨幣」。
//
// 判斷方式不依賴舊系統快照，而是逐筆檢查每一次雨幣增加：
// 退單／改單退回來的錢，不能超過那張單在這套系統裡真正扣過的金額。
// 超出的部分就是憑空生出來的（補單從沒扣款、現金單沒扣款、匯入的單扣款只是歷史紀錄）。
//
// 用法：node scripts/fix-phantom-coins.js [--apply]
const { db, orgOf, addCoins, refreshVip, audit } = require('../src/db');

const APPLY = process.argv.includes('--apply');
const N = v => Number(v || 0).toLocaleString('en-US');
const org = orgOf('1485661086249259088');

// 已經處理過的不再重複（KK 的月冠更正、先前的現金單更正）
const done = new Set(db.prepare(`SELECT ref FROM coin_tx WHERE guild_id=? AND delta < 0
                                 AND reason LIKE '更正：%' AND ref != ''`).all(org).map(r => r.ref));

const credits = db.prepare(`SELECT t.*, COALESCE(c.name, t.user_id) who FROM coin_tx t
  LEFT JOIN customers c ON c.guild_id=t.guild_id AND c.user_id=t.user_id
  WHERE t.guild_id=? AND t.delta > 0 AND t.ref != ''
    AND (t.reason LIKE '退單%' OR t.reason LIKE '修改訂單%' OR t.reason LIKE '刪除訂單%')
  ORDER BY t.id`).all(org);

const bad = [];
for (const t of credits) {
  if (done.has(t.ref)) continue;
  const o = db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?').get(org, t.ref);
  // 匯入的單：流水上的扣款只是把舊系統的歷史搬過來，餘額早已是扣款後的結果，不算「扣過」
  const legacy = o && (['legacy', 'import'].includes(o.source) || t.ref.startsWith('IMP-'));
  const charged = legacy ? 0 : db.prepare(`SELECT COALESCE(SUM(-delta),0) v FROM coin_tx
      WHERE guild_id=? AND ref=? AND delta < 0 AND id < ?`).get(org, t.ref, t.id).v;
  const already = db.prepare(`SELECT COALESCE(SUM(delta),0) v FROM coin_tx
      WHERE guild_id=? AND ref=? AND delta > 0 AND id < ?`).get(org, t.ref, t.id).v;
  const over = t.delta - Math.max(0, charged - already);   // 超額退回的部分
  if (over > 0) bad.push({ ...t, over, charged, source: o ? o.source : '(查無此單)' });
}

if (!bad.length) { console.log('沒有發現憑空生出來的雨幣。'); process.exit(0); }

console.log(`憑空生出來的雨幣：${bad.length} 筆\n`);
console.log('  時間'.padEnd(20) + '老闆'.padEnd(18) + '超額退回'.padStart(9) + '  單號 / 原因');
for (const b of bad) {
  console.log('  ' + b.created_at.slice(0, 16).padEnd(18) + String(b.who).padEnd(18)
    + String(N(b.over)).padStart(9) + '  ' + b.ref + '（' + b.source + '）' + b.reason.slice(0, 20));
}

// 依老闆彙總，並算出更正後餘額
const per = new Map();
for (const b of bad) {
  if (!per.has(b.user_id)) per.set(b.user_id, { who: b.who, total: 0 });
  per.get(b.user_id).total += b.over;
}
console.log('\n依老闆彙總：');
console.log('  老闆'.padEnd(20) + '目前餘額'.padStart(10) + '收回'.padStart(10) + '更正後'.padStart(10));
const negatives = [];
for (const [uid, v] of per) {
  const c = db.prepare('SELECT coins FROM customers WHERE guild_id=? AND user_id=?').get(org, uid);
  const after = (c ? c.coins : 0) - v.total;
  if (after < 0) negatives.push({ who: v.who, after });
  console.log('  ' + String(v.who).padEnd(18) + String(N(c ? c.coins : 0)).padStart(10)
    + String(N(v.total)).padStart(10) + String(N(after)).padStart(10) + (after < 0 ? '  ⚠ 會變負數' : ''));
}
console.log(`\n合計收回 ${N(bad.reduce((a, b) => a + b.over, 0))} 雨幣`);
if (negatives.length) {
  console.log(`\n⚠ ${negatives.length} 位更正後會是負數——代表那些憑空的錢已經被花掉了。`);
  console.log('  餘額會照實記成負數（不隱藏），要抹平請另外用 /儲值 處理，才留得下紀錄。');
}

if (!APPLY) { console.log('\n這只是試算，沒有寫入任何資料。確認無誤後加上 --apply。'); process.exit(0); }

for (const b of bad) {
  addCoins(org, b.user_id, -b.over, `更正：${b.ref} 超額退回（該單實際未扣此金額）`,
    { ref: b.ref, operator: 'system', allowNegative: true });
}
for (const [uid] of per) refreshVip(org, uid);
audit('system', '收回憑空雨幣', `${bad.length} 筆、${bad.reduce((a, b) => a + b.over, 0)} 雨幣`, org, { source: 'salary' });
console.log(`\n已收回 ${bad.length} 筆、${N(bad.reduce((a, b) => a + b.over, 0))} 雨幣。`);
