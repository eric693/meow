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

/** 冠名／身份組到期提醒：每分鐘掃一次，到期與接棒開始各發一則到播報頻道 */
function startTitleWatcher(c) {
  const T = require('../util/titles');
  const { emb } = require('../util/embed');
  const tick = async () => {
    for (const [gid, guild] of c.guilds.cache) {
      try {
        const { started, ended } = T.dueReminders(orgOf(gid));
        if (!started.length && !ended.length) continue;
        const chId = T.announceChannel(gid);
        const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
        // 同一個集團的多台伺服器只由設有播報頻道的那台發，避免重複提醒
        if (!ch) continue;
        for (const t of started) {
          await ch.send({ embeds: [emb(gid, { title: `🟢 ${T.KINDS[t.kind]}開始`, desc: T.titleBlock(t) })] })
            .then(() => T.markStarted(t.id)).catch(() => {});
        }
        for (const t of ended) {
          await ch.send({ embeds: [emb(gid, { title: `⏰ ${T.KINDS[t.kind]}到期`, desc: T.titleBlock(t) })] })
            .then(() => T.markEnded(t.id)).catch(() => {});
        }
      } catch (e) { console.error('冠名提醒失敗：', e.message); }
    }
  };
  tick();
  setInterval(tick, 60 * 1000);
}

/** 結單頻道自動清理：結單滿 N 天（設定 ticket_delete_days，預設 1）就把頻道刪掉 */
function startTicketCleaner(c) {
  const { getNum } = require('../db');
  const tick = async () => {
    for (const [gid, guild] of c.guilds.cache) {
      try {
        const days = getNum('ticket_delete_days', 1, orgOf(gid));
        if (days <= 0) continue;
        const rows = db.prepare(`SELECT id, channel_id FROM tickets
                                  WHERE (src_guild=? OR (src_guild='' AND guild_id=?))
                                    AND status='closed' AND channel_id!=''
                                    AND closed_at IS NOT NULL
                                    AND closed_at <= datetime('now','localtime',?)`)
          .all(gid, orgOf(gid), `-${days} days`);
        for (const r of rows) {
          const ch = await guild.channels.fetch(r.channel_id).catch(() => null);
          if (ch) await ch.delete('結單超過保留期限，自動清理').catch(() => {});
          db.prepare("UPDATE tickets SET channel_id='' WHERE id=?").run(r.id);
        }
      } catch (e) { console.error('結單頻道清理失敗：', e.message); }
    }
  };
  tick();
  setInterval(tick, 10 * 60 * 1000);
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
    startTitleWatcher(c);
    startTicketCleaner(c);
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
  require('./relay').attach(client);

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
