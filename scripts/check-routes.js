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
  // 只用到 roles.cache.find，湊一個最小的假 guild 就能驗，不必真的連上 gateway
  const guild = { id: GUILD, roles: { cache: { find: f => roles.find(f) } } };
  const nameOf = id => (byId.get(id) || {}).name || id;

  const ranks = ['菁英', '宗師', '大師', '不限段位'];
  const genders = ['限女生', '限男生', '不限男女'];
  const rows = [];
  for (const gender of genders)
    for (const want_rank of ranks)
      rows.push({ subject: '技術', service: SERVICE, gender, want_rank, addons: '' });
  for (const gender of ['不限男女', '限女生', '限男生'])
    rows.push({ subject: '娛樂', service: SERVICE, gender, want_rank: '', addons: '' });

  console.log(`派單驗證：${SERVICE}（伺服器 ${GUILD}）\n`);
  for (const t of rows) {
    const ids = P.routedPlayerRoles(guild, t);
    const names = ids.map(nameOf);
    console.log(`${t.subject}單｜${t.gender}｜${t.want_rank || '—'}`.padEnd(24), '→', names.join('、') || '（沒有對到任何身分組）');
  }
  const fallback = getSetting('role_player', '', GUILD);
  console.log(`\n（對不到規則時的退路 role_player：${fallback || '未設定'}）`);
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
