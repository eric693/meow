// Discord 機器人核心
const { Client, GatewayIntentBits, Partials, REST, Routes, Events } = require('discord.js');
const { db, upsertGuild, activeGuildIds, getSetting, orgOf } = require('../db');
const { commands } = require('./commands');
const { err } = require('../util/embed');
const G = require('../util/gifts');

const PREFIX = process.env.CMD_PREFIX || '!';
let client = null;
let ready = false;

function build() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });
}

async function registerFor(guildId) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: commands });
}

/** 重新整理人事名單（!刷新人事） */
function refreshRoster(guildId) {
  const r = db.prepare(`SELECT kind, COUNT(*) c FROM staff WHERE guild_id=? AND active=1 GROUP BY kind`).all(orgOf(guildId));
  const map = Object.fromEntries(r.map(x => [x.kind, x.c]));
  return { player: map.player || 0, cs: map.cs || 0 };
}

async function start() {
  if (!process.env.DISCORD_TOKEN) {
    console.warn('⚠️ 未設定 DISCORD_TOKEN，機器人不啟動（後台網站仍可使用）');
    return;
  }
  client = build();

  client.once(Events.ClientReady, async c => {
    ready = true;
    console.log(`🤖 機器人已上線：${c.user.tag}`);
    for (const [id, g] of c.guilds.cache) {
      upsertGuild(id, g.name);
      G.seedGifts(id);
      await registerFor(id).catch(e => console.error(`指令註冊失敗 ${g.name}：`, e.message));
    }
    const activity = getSetting('bot_activity', '☔ 喚雨接單中');
    try { c.user.setActivity(activity); } catch (e) { console.warn('狀態設定失敗：', e.message); }
  });

  client.on(Events.GuildCreate, async g => {
    upsertGuild(g.id, g.name);
    G.seedGifts(g.id);
    await registerFor(g.id).catch(() => {});
  });
  client.on(Events.GuildDelete, g => {
    db.prepare('UPDATE guilds SET active = 0 WHERE guild_id = ?').run(g.id);
  });

  // ---- Slash / 元件互動 ----
  client.on(Events.InteractionCreate, async i => {
    try {
      if (!i.guildId) return;
      if (i.isAutocomplete()) return require('./slash').autocomplete(i);
      if (i.isChatInputCommand()) {
        const h = require('./slash').handlers[i.commandName];
        if (!h) return;
        return await h(i);
      }
      if (i.isButton() || i.isModalSubmit() || i.isStringSelectMenu()) {
        return await require('./panels').handleInteraction(i);
      }
    } catch (e) {
      console.error('互動錯誤：', e);
      const payload = { embeds: [err(i.guildId, e.message || '發生未知錯誤')], ephemeral: true };
      if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
  });

  // ---- ! 前綴指令 ----
  client.on(Events.MessageCreate, async msg => {
    if (msg.author.bot || !msg.guild || !msg.content.startsWith(PREFIX)) return;
    const body = msg.content.slice(PREFIX.length);
    const name = body.split(/\s+/)[0];
    const args = body.slice(name.length).trim();
    const h = require('./prefix').handlers[name];
    if (!h) return;
    try {
      await h(msg, args);
    } catch (e) {
      console.error(`指令 ${name} 失敗：`, e.message);
      await msg.reply({ embeds: [err(msg.guild.id, e.message || '指令執行失敗')] }).catch(() => {});
    }
  });

  client.on('error', e => console.error('Discord client 錯誤：', e.message));
  await client.login(process.env.DISCORD_TOKEN);
}

module.exports = {
  start,
  isReady: () => ready,
  getClient: () => client,
  refreshRoster,
  registerFor,
  activeGuildIds
};
