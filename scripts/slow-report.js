// 互動延遲報告：node scripts/slow-report.js [幾小時內，預設 24]
//
// 資料來源是 audit_logs.duration_ms，由 src/bot/index.js 在每次互動實際量到的毫秒數。
// Discord 要求 3 秒內回應互動，超過就會變成使用者看到的「這個互動失敗」(10062)，
// 所以這裡以 3000ms 為紅線、1500ms 為警戒線。
require('dotenv').config();
const { db } = require('../src/db');

const hours = Number(process.argv[2]) || 24;
const since = new Date(Date.now() - hours * 3600 * 1000)
  .toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace('T', ' ');

const rows = db.prepare(
  `SELECT action, source, duration_ms, status, actor, created_at
     FROM audit_logs
    WHERE duration_ms >= 0 AND created_at >= ?`).all(since);

if (!rows.length) {
  console.log(`最近 ${hours} 小時沒有量到的互動。`);
  console.log('（duration_ms 是新加的欄位，機器人重啟後才開始累積資料）');
  process.exit(0);
}

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const all = rows.map(r => r.duration_ms).sort((a, b) => a - b);

console.log(`\n=== 最近 ${hours} 小時互動延遲（${rows.length} 筆，自 ${since}）===`);
console.log(`中位數 ${pct(all, 0.5)}ms ｜ p90 ${pct(all, 0.9)}ms ｜ p99 ${pct(all, 0.99)}ms ｜ 最慢 ${all[all.length - 1]}ms`);
console.log(`超過 1.5 秒：${all.filter(n => n >= 1500).length} 筆 ｜ 超過 3 秒（會逾時）：${all.filter(n => n >= 3000).length} 筆`);

// 依動作分組，找出「哪個操作慢」而不只是「有操作慢」
const byAction = new Map();
for (const r of rows) {
  const k = `${r.source}／${r.action}`;
  if (!byAction.has(k)) byAction.set(k, []);
  byAction.get(k).push(r.duration_ms);
}
const stats = [...byAction.entries()].map(([k, v]) => {
  const s = v.sort((a, b) => a - b);
  return { k, n: s.length, med: pct(s, 0.5), p90: pct(s, 0.9), max: s[s.length - 1] };
}).sort((a, b) => b.p90 - a.p90);

console.log('\n--- 依動作排序（p90 由慢到快，只列前 15 名）---');
console.log('p90'.padStart(7) + '中位'.padStart(8) + '最慢'.padStart(8) + '次數'.padStart(7) + '  動作');
for (const s of stats.slice(0, 15)) {
  console.log(`${(s.p90 + 'ms').padStart(7)}${(s.med + 'ms').padStart(8)}${(s.max + 'ms').padStart(8)}${String(s.n).padStart(7)}  ${s.k}`);
}

const worst = rows.sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 10);
console.log('\n--- 最慢的 10 次 ---');
for (const r of worst) {
  console.log(`${String(r.duration_ms).padStart(6)}ms  ${r.created_at}  ${r.action}（${r.actor}）${r.status !== 'ok' ? ' [' + r.status + ']' : ''}`);
}
console.log();
