#!/usr/bin/env node
// 一次性修補：把已經開好的名片專區裡「老闆」的檢視權限拿掉（匿名單不該讓陪玩認出老闆）
// 用法：node scripts/fix-card-perms.js [--apply]
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { db } = require('../src/db');

const APPLY = process.argv.includes('--apply');
const rows = db.prepare(`SELECT id, guild_id, src_guild, channel_id, card_channel_id, customer_id, seq
                         FROM tickets WHERE status!='closed' AND IFNULL(card_channel_id,'')!=''`).all();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async () => {
  for (const t of rows) {
    const ch = await client.channels.fetch(t.card_channel_id).catch(() => null);
    if (!ch) { console.log(`#${t.seq} 名片專區已不存在，略過`); continue; }
    const has = ch.permissionOverwrites.cache.has(t.customer_id);
    console.log(`#${t.seq} ${ch.name}：老闆權限 ${has ? '有 → 移除' : '無（不用動）'}`);
    if (has && APPLY) await ch.permissionOverwrites.delete(t.customer_id, '匿名單：老闆不進名片專區').catch(e => console.log('  失敗', e.message));
  }
  console.log(APPLY ? '✅ 完成' : '🔍 試算（加 --apply 才會改）');
  client.destroy();
});
client.login(process.env.DISCORD_TOKEN);
