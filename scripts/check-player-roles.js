#!/usr/bin/env node
// 檢查「陪玩身分組」設定有沒有漏掉新開的身分組。
//
// 每次新增遊戲線就會多一批身分組（LOL-男技術、TFT-女娛樂…），
// 但後台的陪玩身分組是一份固定清單，忘了補就會有人報不了單，
// 而且錯誤訊息看不出是哪裡沒設。唯讀，只列出建議。
// 用法：node scripts/check-player-roles.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { db, getSetting } = require('../src/db');

// 看起來是陪玩的身分組：帶技術／娛樂／聲優／歌手／獨家／陪等字樣；考官與分隔線除外
const LOOKS_LIKE = /技術|娛樂|聲優|歌手|獨家|陪/;
// 排除：考官另有身分組；「--- 陪玩身份組 ---」這類分隔線是裝飾用的，
// 常常整個伺服器的人都有，列進去等於誰都能報單
const NOT = /考官|管理|客服|培訓|小編|店長|^[\s\-─—_=]*$|[\-─—_=]{3}/;

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const guilds = db.prepare('SELECT guild_id, name FROM guilds WHERE active=1').all();
  let missing = 0;
  for (const g of guilds) {
    const roles = await rest.get(Routes.guildRoles(g.guild_id)).catch(() => null);
    if (!roles) { console.log(`⏭️  ${g.name}：機器人不在這個伺服器，略過`); continue; }
    const set = getSetting('role_player', '', g.guild_id).split(',').map(x => x.trim()).filter(Boolean);
    const byId = new Map(roles.map(r => [r.id, r]));
    const perf = roles.filter(r => LOOKS_LIKE.test(r.name) && !NOT.test(r.name));
    const gaps = perf.filter(r => !set.includes(r.id));
    const dead = set.filter(id => !byId.has(id));
    console.log(`\n=== ${g.name}（已設定 ${set.length} 個）`);
    if (!set.length) console.log('   ⚠️  完全沒設定：只有建過檔的陪玩能報單，靠身分組的新人會被擋');
    dead.forEach(id => console.log(`   ❌ 設定裡的 ${id} 這個身分組已經不存在了`));
    gaps.forEach(r => { missing++; console.log(`   ➕ 建議加入：${r.name}（${r.id}）`); });
    if (set.length && !gaps.length && !dead.length) console.log('   ✅ 沒有漏掉的身分組');
  }
  console.log('\n' + '═'.repeat(56));
  console.log(missing ? `有 ${missing} 個身分組沒被列入，請到後台「系統設定 → 陪玩身分組」補上`
                      : '陪玩身分組設定完整');
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
