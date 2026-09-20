#!/usr/bin/env node
// BINGO／雨果幣歸零：把測試期間的局數、流水與餘額清掉，正式上線從 0 開始。
// 預設是乾跑（只印出會刪什麼）；真的要刪要加 --yes。
//   node scripts/reset-bingo.js             ← 乾跑，看看會刪多少
//   node scripts/reset-bingo.js --yes       ← 真的清空（局數＋流水＋餘額）
//   node scripts/reset-bingo.js --yes --keep-wallet   ← 只清局數與下注紀錄，保留大家的餘額
require('dotenv').config();
const { db, orgOf } = require('../src/db');

const ORG = orgOf(process.env.GUILD_ID || '');
const GO = process.argv.includes('--yes');
const KEEP_WALLET = process.argv.includes('--keep-wallet');
if (!ORG) { console.error('❌ .env 沒有 GUILD_ID，不知道要清哪個集團'); process.exit(1); }

const one = (sql, ...a) => db.prepare(sql).get(ORG, ...a);
const before = {
  rounds: one('SELECT COUNT(*) c FROM bingo_rounds WHERE guild_id=?').c,
  jackpot: one('SELECT COUNT(*) c FROM bingo_rounds WHERE guild_id=? AND lines>=12').c,
  tx: one('SELECT COUNT(*) c FROM hugo_tx WHERE guild_id=?').c,
  wallets: one('SELECT COUNT(*) c FROM hugo_wallet WHERE guild_id=?').c,
  balance: one('SELECT COALESCE(SUM(balance),0) v FROM hugo_wallet WHERE guild_id=?').v
};

console.log(`集團 ${ORG}　${GO ? '【實際清除】' : '【乾跑，不會動到資料】'}`);
console.log(`  BINGO 局數     ${before.rounds}（其中頭獎 ${before.jackpot}）→ 0`);
console.log(`  雨果幣流水     ${before.tx} 筆 → 0`);
console.log(KEEP_WALLET
  ? `  錢包           ${before.wallets} 個、餘額 ${before.balance} → 保留（--keep-wallet）`
  : `  錢包           ${before.wallets} 個、餘額 ${before.balance} → 全部歸零`);

if (!GO) { console.log('\n確定沒問題再加 --yes 執行。'); process.exit(0); }

db.transaction(() => {
  db.prepare('DELETE FROM bingo_rounds WHERE guild_id=?').run(ORG);
  db.prepare('DELETE FROM hugo_tx WHERE guild_id=?').run(ORG);
  if (!KEEP_WALLET) db.prepare('DELETE FROM hugo_wallet WHERE guild_id=?').run(ORG);
  // 遊戲相關的稽核紀錄一起收掉，總覽與紀錄頁才不會留著測試期的雜訊
  db.prepare("DELETE FROM audit_logs WHERE guild_id=? AND source='game'").run(ORG);
})();

const after = {
  rounds: one('SELECT COUNT(*) c FROM bingo_rounds WHERE guild_id=?').c,
  tx: one('SELECT COUNT(*) c FROM hugo_tx WHERE guild_id=?').c,
  wallets: one('SELECT COUNT(*) c FROM hugo_wallet WHERE guild_id=?').c
};
console.log(`\n✅ 已清除。現在：局數 ${after.rounds}、流水 ${after.tx} 筆、錢包 ${after.wallets} 個`);
console.log('　 頭獎剩餘份數已回到設定值，2% 的機率會重新生效。');
