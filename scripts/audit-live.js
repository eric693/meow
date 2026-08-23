#!/usr/bin/env node
// 只檢查「新系統上線後」自己產生的資料，把舊系統匯入的痕跡排除在外。
// 目的是回答一個問題：現在這套系統本身有沒有在漏錢？唯讀。
const { db } = require('../src/db');

// 舊系統的資料分兩批匯入（source=legacy／import，單號 IMP-）；其餘才是新系統自己開的單
const LIVE_ORDER = "source NOT IN ('legacy','import') AND order_no NOT LIKE 'IMP-%'";
const N = v => Number(v || 0).toLocaleString('en-US');
// 現金單誤退雨幣、0 元空流水這兩個 bug 修好之前留下的紀錄是既成的歷史
//（雨幣已另以「更正」分錄收回），這裡只檢查修好之後有沒有再發生。
// 基準點直接取那筆更正分錄的時間，不寫死時間字串——資料庫與這支腳本的時區未必一致。
const FIXED_AT = db.prepare(`SELECT COALESCE(MAX(created_at), '9999') t FROM coin_tx
                             WHERE reason LIKE '更正：現金單退單誤退雨幣%'`).get().t;
console.log(`（基準：帳務更正於 ${FIXED_AT}，只檢查此後的資料）`);
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

// 用雨幣付的單退掉時要有退還的流水；現金／轉帳的單當初沒扣過，本來就不該退幣
check('雨幣單退掉時都有退還雨幣',
  db.prepare(`SELECT o.order_no FROM orders o WHERE ${LIVE_ORDER}
     AND o.status='refunded' AND o.customer_id != '' AND o.amount > 0
     AND o.pay_method LIKE '%雨幣%' AND o.note NOT LIKE '%不退幣%'
     AND NOT EXISTS (SELECT 1 FROM coin_tx t
                     WHERE t.guild_id=o.guild_id AND t.ref=o.order_no AND t.delta > 0)`).all(),
  r => r.order_no);

// 判準是「這張單的雨幣淨效果」，不是「有沒有出現過退幣分錄」：
// 誤退之後已用『更正』分錄收回的，淨額會回到 0，那筆錢並沒有真的漏掉。
// 早期版本改看時間基準，結果每次補完更正還是一直誤報 11 筆已收回的舊帳。
check('現金單退掉時沒有誤退雨幣（看淨效果）',
  db.prepare(`SELECT o.order_no, o.amount,
       (SELECT COALESCE(SUM(t.delta),0) FROM coin_tx t
        WHERE t.guild_id=o.guild_id AND t.ref=o.order_no) net
     FROM orders o WHERE ${LIVE_ORDER}
     AND o.status='refunded' AND o.pay_method NOT LIKE '%雨幣%' AND o.amount > 0
     AND (SELECT COALESCE(SUM(t.delta),0) FROM coin_tx t
          WHERE t.guild_id=o.guild_id AND t.ref=o.order_no) > 0`).all(),
  r => `${r.order_no} 憑空多出 ${N(r.net)} 雨幣`);

// ---- 收款對帳 ----
// 現金單現在可以先核銷（財務不會隨時在線，擋著客服沒辦法即時幫陪玩核銷），
// 由財務事後對帳、沒收到款再取消核銷。所以「未對帳」是待辦事項而非帳務錯誤，
// 這裡只把曝險列出來提醒，不計入 problems。
const unreconciled = db.prepare(`SELECT order_no, amount, staff_share, status, created_at
   FROM orders WHERE ${LIVE_ORDER}
   AND cash_confirmed = 0 AND status <> 'refunded' ORDER BY created_at`).all();
if (!unreconciled.length) {
  console.log('✅ 現金／轉帳單都已對帳確認收款');
} else {
  const amt = unreconciled.reduce((t, r) => t + Number(r.amount || 0), 0);
  const paid = unreconciled.filter(r => r.status === 'settled')
    .reduce((t, r) => t + Number(r.staff_share || 0), 0);
  console.log(`⚠️  尚未對帳的現金／轉帳單：${unreconciled.length} 筆／${N(amt)}`
    + `（其中已核銷、抽成已付出 ${N(paid)}）— 請財務到後台「收款對帳」處理`);
  unreconciled.slice(0, 10).forEach(r =>
    console.log(`   ${r.order_no} ${N(r.amount)} ${r.status === 'settled' ? '已核銷' : '未核銷'}（${r.created_at}）`));
  if (unreconciled.length > 10) console.log(`   …另有 ${unreconciled.length - 10} 筆`);
}

// 「儲值必填匯款憑證」是後來才加的規則，之前的舊儲值沒有憑證是正常的。
// 基準點取第一筆真的留了憑證的儲值＝規則上線的時間，這樣不用寫死日期也不會誤報舊帳。
const PROOF_SINCE = db.prepare("SELECT MIN(created_at) t FROM coin_tx WHERE proof <> ''").get().t;
if (!PROOF_SINCE) {
  console.log('⏭️  儲值匯款憑證：規則尚未產生任何資料，略過');
} else {
  check('儲值都有留匯款憑證',
    db.prepare(`SELECT id, user_id, delta, created_at FROM coin_tx
       WHERE delta > 0 AND proof = '' AND created_at >= ?
         AND (reason LIKE '%儲值%' OR reason LIKE '%調整%')`).all(PROOF_SINCE),
    r => `#${r.id} ${r.user_id} +${N(r.delta)}（${r.created_at}）`);
}

check('雨幣流水沒有金額為 0 的空紀錄',
  db.prepare(`SELECT id, user_id, reason FROM coin_tx WHERE delta = 0 AND created_at > '${FIXED_AT}'`).all(),
  r => `#${r.id} ${r.user_id} ${r.reason}`);

// 提領：新系統的提領一定對得到陪玩，且不超過當時的可提領
check('新系統的提領都對得到陪玩',
  db.prepare(`SELECT w.id, w.staff_id, w.amount FROM withdrawals w
     WHERE w.created_at >= (SELECT MIN(created_at) FROM orders WHERE ${LIVE_ORDER})
     AND w.note NOT LIKE 'WTH-%'
     AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.guild_id=w.guild_id AND s.user_id=w.staff_id)`).all(),
  r => `#${r.id} ${r.staff_id} ${N(r.amount)}`);

console.log('\n' + '═'.repeat(64));
console.log(problems ? `新系統資料發現 ${problems} 個問題` : '新系統上線後產生的資料完全一致，沒有漏帳');
