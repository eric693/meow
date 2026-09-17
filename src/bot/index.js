// Discord 機器人核心
const { Client, GatewayIntentBits, Partials, REST, Routes, Events } = require('discord.js');
const { db, upsertGuild, activeGuildIds, getSetting, orgOf, HOME_GUILD } = require('../db');
const { commands } = require('./commands');
const { err } = require('../util/embed');
const { logAction, slashArgs, modalArgs } = require('../util/log');
const G = require('../util/gifts');

const PREFIX = process.env.CMD_PREFIX || '!';
let client = null;
let ready = false;

// ---- Discord 限流 ----
// @discordjs/rest 收到 429 的預設行為是「照 retry_after 睡完再送」，不會報錯。
// 2026-09-16 Discord 對建立頻道回了約 16 小時的 retry_after，下單、考核、開頻道
// 全部默默卡住一整晚：使用者只看到「機器人思考中…」，連按十幾次；限流一解除，
// 排隊的請求一口氣全部執行，建出一堆沒人在等的頻道，而且單號全部撞在同一號。
// 改成：等太久的直接拋錯，讓使用者立刻知道要晚點再試。
const REJECT_AFTER_MS = {
  // 建頻道是使用者當下在等的動作，15 秒就該放棄
  '/guilds/:id/channels': 15_000
};
// 其餘路由維持原本「等完再送」的行為：頻道改名的 sublimit 最多等 10 分鐘，
// 門檻放在 11 分鐘，改名照舊會成功；只擋掉像這次這種動輒數小時的異常等待。
const REJECT_DEFAULT_MS = 660_000;
// 真正要等多久不一定寫在 timeToReset：Discord 對建頻道的隱藏 sublimit 不帶重置標頭，
// timeToReset 會算成 0，等待時間藏在 retryAfter／sublimitTimeout（這次就是這種）。三個取最大。
const waitOf = d => Math.max(d.timeToReset || 0, d.retryAfter || 0, d.sublimitTimeout || 0);
function rejectOnRateLimit(d) {
  const wait = waitOf(d);
  const reject = wait > (REJECT_AFTER_MS[d.route] ?? REJECT_DEFAULT_MS);
  // 這個函式每次收到 429 都會被問，比 'rateLimited' 事件可靠（sublimit 那條路不發事件）
  if (wait >= 5000) {
    console.warn(`Discord 限流：${d.method} ${d.route} 需等 ${Math.round(wait / 1000)} 秒`
      + `${d.global ? '（全域）' : ''}${reject ? '，已直接回報錯誤' : '，排隊等待中'}`);
  }
  return reject;
}

const mins = ms => Math.max(1, Math.ceil(ms / 60000));
/** 把限流錯誤轉成看得懂的訊息；不是限流就回 null */
function rateLimitMessage(e) {
  if (!e || !String(e.name || '').startsWith('RateLimitError')) return null;
  const wait = mins(waitOf(e));
  const what = e.route === '/guilds/:id/channels' ? '建立頻道' : '這個動作';
  const human = wait >= 120 ? `約 ${Math.round(wait / 60)} 小時` : `約 ${wait} 分鐘`;
  return `Discord 暫時限制機器人${what}（${human}後解除），請稍後再試。\n`
       + '這是 Discord 端的保護機制，不是你的操作有問題，也不用重複點。';
}

function build() {
  return new Client({
    rest: { rejectOnRateLimit },
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
        // 提醒時一併標客服（後台 role_cs，可填多個），沒設就只發嵌入訊息
        const cs = getSetting('role_cs', '', gid).split(',').map(x => x.trim()).filter(Boolean)
          .map(x => `<@&${x.replace(/^<@&|>$/g, '')}>`).join(' ');
        for (const t of started) {
          await ch.send({ content: cs || undefined, embeds: [emb(gid, { title: `🟢 ${T.KINDS[t.kind]}開始`, desc: T.titleBlock(t) })] })
            .then(() => T.markStarted(t.id)).catch(() => {});
        }
        for (const t of ended) {
          await ch.send({ content: cs || undefined, embeds: [emb(gid, { title: `⏰ ${T.KINDS[t.kind]}到期`, desc: T.titleBlock(t) })] })
            .then(() => T.markEnded(t.id)).catch(() => {});
        }
      } catch (e) { console.error('冠名提醒失敗：', e.message); }
    }
  };
  tick();
  setInterval(tick, 60 * 1000);
}

/** 影音名片快取清理：超過 N 天沒被用到就刪（設定 card_cache_days，預設 30；設 0 為不清） */
function startCardCacheCleaner() {
  const CardMedia = require('../util/cardmedia');
  const { getNum } = require('../db');
  const tick = () => {
    try {
      const days = getNum('card_cache_days', 30, HOME_GUILD);
      if (days <= 0) return;
      const r = CardMedia.pruneCache(days);
      if (r.files) console.log(`🧹 名片快取清理：刪掉 ${r.files} 個檔案，釋出 ${r.mb} MB`);
    } catch (e) { console.error('名片快取清理失敗：', e.message); }
  };
  tick();
  setInterval(tick, 24 * 60 * 60 * 1000);
}

/** 結單頻道自動清理：結單滿 N 天（設定 ticket_delete_days，預設 1）就把頻道刪掉 */
function startTicketCleaner(c) {
  const { getNum } = require('../db');
  // 設定存在單一伺服器底下，綁集團後才退回集團的值
  const days = gid => {
    const own = getSetting('ticket_delete_days', '', gid);
    if (own !== '') { const v = Number(own); return Number.isNaN(v) ? 1 : v; }
    return getNum('ticket_delete_days', 1, orgOf(gid));
  };
  const tick = async () => {
    for (const [gid, guild] of c.guilds.cache) {
      try {
        const d = days(gid);
        if (d <= 0) continue;
        // 只清「剛過期」的單：上限 30 天，避免第一次啟用就把久遠的歷史頻道整批刪掉；
        // 每輪最多 20 間，免得撞上 Discord 的刪頻道速率限制
        const rows = db.prepare(`SELECT id, channel_id, card_channel_id FROM tickets
                                  WHERE (src_guild=? OR (src_guild='' AND guild_id=?))
                                    AND status='closed' AND channel_id!=''
                                    AND closed_at IS NOT NULL
                                    AND closed_at <= datetime('now','localtime',?)
                                    AND closed_at >= datetime('now','localtime','-30 days')
                                  ORDER BY closed_at LIMIT 20`)
          .all(gid, orgOf(gid), `-${d} days`);
        for (const r of rows) {
          // 結單時名片專區是留著的，保留期限到了跟包廂一起收
          for (const cid of [r.channel_id, r.card_channel_id].filter(Boolean)) {
            const ch = await guild.channels.fetch(cid).catch(() => null);
            if (ch) await ch.delete('結單超過保留期限，自動清理').catch(() => {});
          }
          db.prepare("UPDATE tickets SET channel_id='', card_channel_id='' WHERE id=?").run(r.id);
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
    // bot_activity 是存在各伺服器底下的設定，優先讀主伺服器那份，再退回全域值
    const activity = getSetting('bot_activity', '', HOME_GUILD)
                  || getSetting('bot_activity', '☔ 喚雨接單中');
    try { c.user.setActivity(activity); } catch (e) { console.warn('狀態設定失敗：', e.message); }
    startTitleWatcher(c);
    startTicketCleaner(c);
    startCardCacheCleaner();
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
    // 從收到互動算到處理完的毫秒數，寫進 audit_logs.duration_ms。
    // Discord 只給 3 秒回應時間，這個數字就是「還剩多少餘裕」的唯一依據。
    const t0 = Date.now();
    try {
      if (isCmd) {
        const h = require('./slash').handlers[i.commandName];
        if (!h) return;
        await h(i);
      } else if (i.isButton() || i.isModalSubmit() || i.isStringSelectMenu()) {
        await require('./panels').handleInteraction(i);
      } else return;
      logAction({ ...base, detail, status: i._denied ? 'deny' : 'ok', ms: Date.now() - t0 });
    } catch (e) {
      const limited = rateLimitMessage(e);
      if (limited) console.warn(`互動被限流擋下：${action}（${e.route}，${Math.round(waitOf(e) / 1000)} 秒）`);
      else console.error('互動錯誤：', e);
      const msg = limited || e.message || '發生未知錯誤';
      logAction({ ...base, detail: `${detail}${detail ? ' | ' : ''}錯誤：${limited ? '限流' : e.message}`, status: 'fail', ms: Date.now() - t0 });
      const payload = { embeds: [err(i.guildId, msg)], ephemeral: true };
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
    const h = require('./prefix').handlers[name] || require('./prefix').snippetHandler(msg.guild.id, name);
    if (!h) return;
    // 有些訊息回覆不了（系統訊息、原訊息已被刪掉），Discord 會丟
    // REPLIES_CANNOT_REPLY_TO_SYSTEM_MESSAGE / Unknown Message，整個指令就白做了。
    // 包一層：回覆不了就直接在頻道發，結果不會憑空消失。
    const nativeReply = msg.reply.bind(msg);
    msg.reply = async payload => {
      try { return await nativeReply(payload); }
      catch (e) {
        console.warn(`回覆訊息失敗，改用頻道發送：${e.message}`);
        return msg.channel.send(payload);
      }
    };
    const base = { guildId: msg.guild.id, source: 'prefix', action: `${PREFIX}${name}`,
                   user: msg.author, channelId: msg.channelId };
    const t0 = Date.now();
    try {
      await h(msg, args);
      logAction({ ...base, detail: args, status: 'ok', ms: Date.now() - t0 });
    } catch (e) {
      console.error(`指令 ${name} 失敗：`, e.message);
      // 權限相關的錯誤另外標記，方便後台過濾誰在踩紅線
      const denied = /權限|僅限|只有/.test(e.message || '');
      logAction({ ...base, detail: `${args}${args ? ' | ' : ''}${e.message}`, status: denied ? 'deny' : 'fail', ms: Date.now() - t0 });
      await msg.reply({ embeds: [err(msg.guild.id, rateLimitMessage(e) || e.message || '指令執行失敗')] })
        .catch(() => {});
    }
  });

  require('./voice').attach(client);
  require('./relay').attach(client);
  require('./welcome').attach(client);

  client.on('error', e => console.error('Discord client 錯誤：', e.message));
  await client.login(process.env.DISCORD_TOKEN);
}

module.exports = {
  start,
  isReady: () => ready,
  getClient: () => client,
  refreshRoster,
  registerFor,
  activeGuildIds,
  // 測試用：限流判斷與訊息
  rejectOnRateLimit, rateLimitMessage };
