#!/usr/bin/env node
// 驗證派單規則：列出每一種下單組合實際會標到哪些陪玩身分組。唯讀。
// 用法：node scripts/check-routes.js [服務名]   例：node scripts/check-routes.js 聯盟戰棋
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { getSetting } = require('../src/db');
const P = require('../src/bot/panels');

const SERVICE = process.argv[2] || '聯盟戰棋';
const GUILD = process.env.GUILD_ID;

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const roles = await rest.get(Routes.guildRoles(GUILD));
  const byId = new Map(roles.map(r => [r.id, r]));
  // 湊一個假的 roles.cache 就能驗，不必真的連上 gateway。
  // 規則沒命中時會走 autoPlayerRoles，那邊用到 filter／map，一併補齊。
  const cache = {
    find: f => roles.find(f),
    filter: f => { const m = new Map(roles.filter(f).map(r => [r.id, r])); m.map = fn => [...m.values()].map(fn); return m; },
    map: fn => roles.map(fn),
    get: id => byId.get(id),
    has: id => byId.has(id),
    values: () => roles.values(),
    [Symbol.iterator]: () => roles.map(r => [r.id, r])[Symbol.iterator]()
  };
  const guild = { id: GUILD, roles: { cache } };
  const nameOf = id => (byId.get(id) || {}).name || id;

  // 段位選項要跟下單選單同一個來源，而且男女不一樣（例如女生沒有「頂尖賦能」）。
  // 自己寫死清單會驗到選單根本不會出現的組合，看起來像有 bug。
  const genders = ['限女生', '限男生', '不限男女'];
  const rows = [];
  for (const gender of genders)
    for (const want_rank of P.wantRankOptions(GUILD, gender, SERVICE))
      // 欄位對應要跟建單時一致：service 存的是技術／娛樂，subject 才是遊戲名
      rows.push({ service: '技術', subject: SERVICE, gender, want_rank, addons: '' });
  for (const gender of ['不限男女', '限女生', '限男生'])
    rows.push({ service: '娛樂', subject: SERVICE, gender, want_rank: '', addons: '' });

  console.log(`派單驗證：${SERVICE}（伺服器 ${GUILD}）\n`);
  for (const t of rows) {
    const ids = P.routedPlayerRoles(guild, t);
    const names = ids.map(nameOf);
    console.log(`${t.service}單｜${t.gender}｜${t.want_rank || '—'}`.padEnd(24), '→', names.join('、') || '（沒有對到任何身分組）');
  }
  const fallback = getSetting('role_player', '', GUILD);
  console.log(`\n（對不到規則時的退路 role_player：${fallback || '未設定'}）`);
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
