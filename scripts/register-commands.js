// 手動註冊 slash 指令：npm run register（平常機器人上線會自動註冊）
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('../src/bot/commands');
const { activeGuildIds } = require('../src/db');

const { DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('❌ 請先在 .env 設定 DISCORD_TOKEN、DISCORD_CLIENT_ID');
  process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: [] });
  console.log('✅ 已清空全域指令（改由各伺服器即時註冊）');
  for (const gid of activeGuildIds()) {
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, gid), { body: commands })
      .then(() => console.log(`  ↳ 已註冊 ${commands.length} 個指令到 ${gid}`))
      .catch(e => console.error(`  ↳ ${gid} 註冊失敗：`, e.message));
  }
  process.exit(0);
})();
