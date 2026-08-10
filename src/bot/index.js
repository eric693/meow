// Discord 機器人核心
const { Client, GatewayIntentBits, Partials, REST, Routes, Events } = require('discord.js');
const { db, upsertGuild, activeGuildIds, getSetting, orgOf } = require('../db');
const { commands } = require('./commands');
const { err } = require('../util/embed');
const { logAction, slashArgs, modalArgs } = require('../util/log');
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
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates
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
    if (!i.guildId || i.isAutocomplete?.()) {
      if (i.isAutocomplete?.()) return require('./slash').autocomplete(i).catch(() => {});
      return;
    }
    // 每一次互動都留紀錄：斜線指令記指令名與參數，按鈕／表單記 customId
    const isCmd = i.isChatInputCommand();
    const source = isCmd ? 'slash' : i.isButton() ? 'button' : i.isModalSubmit() ? 'modal' : 'select';
    const action = isCmd ? `/${i.commandName}` : (i.customId || '未知互動');
    const detail = isCmd ? slashArgs(i) : i.isModalSubmit() ? modalArgs(i) : '';
    const base = { guildId: i.guildId, source, action, user: i.user, channelId: i.channelId };
    try {
      if (isCmd) {
        const h = require('./slash').handlers[i.commandName];
        if (!h) return;
        await h(i);
      } else if (i.isButton() || i.isModalSubmit() || i.isStringSelectMenu()) {
        await require('./panels').handleInteraction(i);
      } else return;
      logAction({ ...base, detail, status: i._denied ? 'deny' : 'ok' });
    } catch (e) {
      console.error('互動錯誤：', e);
      logAction({ ...base, detail: `${detail}${detail ? ' | ' : ''}錯誤：${e.message}`, status: 'fail' });
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
    const base = { guildId: msg.guild.id, source: 'prefix', action: `${PREFIX}${name}`,
                   user: msg.author, channelId: msg.channelId };
    try {
      await h(msg, args);
      logAction({ ...base, detail: args, status: 'ok' });
    } catch (e) {
      console.error(`指令 ${name} 失敗：`, e.message);
      // 權限相關的錯誤另外標記，方便後台過濾誰在踩紅線
      const denied = /權限|僅限|只有/.test(e.message || '');
      logAction({ ...base, detail: `${args}${args ? ' | ' : ''}${e.message}`, status: denied ? 'deny' : 'fail' });
      await msg.reply({ embeds: [err(msg.guild.id, e.message || '指令執行失敗')] }).catch(() => {});
    }
  });

  require('./voice').attach(client);

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
