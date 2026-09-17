// 自動語音房：進入「創建語音房」頻道就給一間專屬語音，最後一人離開就收回。
//
// 收回的房間不直接刪掉，先藏起來留著（最多 voice_room_pool 間，預設 3），
// 下一個人進大廳時優先沿用。Discord 的「建立頻道」額度是整個伺服器共用的，
// 2026-09-16 主群被限制了約 16 小時，下單、考核全部卡住；語音房約占建頻道量的兩成，
// 重複使用就能省下這一塊。
const { ChannelType, PermissionsBitField, Events } = require('discord.js');
const { getSetting } = require('../db');
const { roleIds } = require('./perm');

const F = PermissionsBitField.Flags;

// 機器人這次上線期間建立的房間，避免誤刪既有頻道
const created = new Set();

// 待用中的房間：channelId → 收回時間
const idle = new Map();
// 正在收回的房間（清聊天要花點時間，避免同一間被收兩次）
const parking = new Set();

const IDLE_NAME = '💤 待用語音房';
const roomTemplate = gid => getSetting('voice_room_name', '', gid) || '{name} 老闆的專屬語音';
const poolSize = gid => {
  const n = Number(getSetting('voice_room_pool', '3', gid));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 10) : 3;
};

// ---- 改名額度 ----
// Discord 規定每個頻道 10 分鐘內最多改名 2 次，超過的改名會被排隊（最多等 10 分鐘）。
// 老闆不能在大廳乾等，所以自己記帳：額度不夠的房間先不拿來用，改開新房。
const RENAME_WINDOW = 10 * 60 * 1000;
const renames = new Map();   // channelId → [改名時間…]
const recentRenames = id => (renames.get(id) || []).filter(t => Date.now() - t < RENAME_WINDOW);
const canRename = id => recentRenames(id).length < 2;
function noteRename(id) { renames.set(id, [...recentRenames(id), Date.now()]); }
// 重開機後不知道之前改過幾次名，保守當作額度已經用完，10 分鐘後才開始沿用
function assumeRenamed(id) { renames.set(id, [Date.now(), Date.now()]); }

// 重開機後 created 會清空，之前開的房就變成沒人管的孤兒、永遠不會自動關。
// 所以除了記憶體，再用「在自動語音分類底下 + 房名符合設定的格式」把它認出來。
function isAutoRoom(ch) {
  if (!ch || ch.type !== ChannelType.GuildVoice) return false;
  if (created.has(ch.id) || idle.has(ch.id)) return true;
  const gid = ch.guild.id;
  if (ch.id === getSetting('channel_voice_hub', '', gid)) return false;   // 大廳本身不能刪
  const cat = getSetting('category_voice', '', gid);
  if (!cat || ch.parentId !== cat) return false;
  if (ch.name === IDLE_NAME) return true;
  // 由房名格式推出比對規則：{name} 是使用者暱稱，其餘是固定字樣
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = roomTemplate(gid).split('{name}').map(esc).join('.{1,80}');
  return new RegExp(`^${pattern}$`).test(ch.name);
}

// 機器人在房內要能管理與清聊天（沿用時要把上一位的訊息清掉）
const botAllow = [F.ViewChannel, F.Connect, F.MoveMembers, F.ManageChannels,
                  F.ReadMessageHistory, F.ManageMessages];

// 私人房的權限配置：@everyone 看不到也進不來，只有老闆本人、客服／管理身分組與機器人進得去。
// 陪玩由客服在開單流程確認後人工拉進來，所以客服必須有 MoveMembers＋Connect
//（Discord 搬人時檢查的是「搬的人」在目標頻道的權限，被搬的人不需要事先開通）。
function privateOverwrites(guild, ownerId, botId) {
  const staffRoles = [...new Set([...roleIds(guild.id, 'role_cs'), ...roleIds(guild.id, 'role_admin')])]
    .filter(id => guild.roles.cache.has(id));   // 身分組被刪掉時要濾掉，否則建頻道會整個失敗
  return [
    { id: guild.roles.everyone.id, deny: [F.ViewChannel, F.Connect] },
    { id: ownerId,
      allow: [F.ViewChannel, F.Connect, F.Speak, F.Stream, F.ManageChannels, F.MoveMembers] },
    ...staffRoles.map(id => ({
      id, allow: [F.ViewChannel, F.Connect, F.Speak, F.MoveMembers, F.ManageChannels]
    })),
    // 機器人自己也要留一份，否則沒人時刪不掉房間
    { id: botId, allow: botAllow }
  ];
}

function publicOverwrites(ownerId, botId) {
  return [
    { id: ownerId, allow: [F.ManageChannels, F.MoveMembers, F.Connect, F.Speak] },
    { id: botId, allow: botAllow }
  ];
}

// 待用中：誰都看不到，只剩機器人
const idleOverwrites = (guild, botId) => [
  { id: guild.roles.everyone.id, deny: [F.ViewChannel, F.Connect] },
  { id: botId, allow: botAllow }
];

/**
 * 清掉房內聊天室的訊息。回傳 true 表示清乾淨了，才可以給下一個人用。
 * Discord 不允許批次刪除 14 天以前的訊息；清不乾淨就不沿用，直接刪房，
 * 絕不能讓下一位老闆看到上一位的聊天內容。
 */
async function wipeChat(ch) {
  for (let round = 0; round < 10; round++) {
    const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
    if (!msgs) return false;              // 讀不到＝沒把握清乾淨
    if (!msgs.size) return true;
    const gone = await ch.bulkDelete(msgs, true).catch(() => null);
    if (!gone || gone.size < msgs.size) return false;   // 有刪不掉的（太舊或沒權限）
  }
  return false;   // 超過一千則，保險起見不沿用
}

async function dropRoom(ch, reason) {
  created.delete(ch.id);
  idle.delete(ch.id);
  renames.delete(ch.id);
  await ch.delete(reason).catch(() => {});
}

const idleCount = guild => [...idle.keys()].filter(id => guild.channels.cache.has(id)).length;

/** 最後一人離開：收進待用池；池子滿了、或聊天清不乾淨，就直接刪 */
async function parkRoom(ch, botId) {
  if (parking.has(ch.id) || idle.has(ch.id)) return;
  const guild = ch.guild;
  if (idleCount(guild) >= poolSize(guild.id)) return dropRoom(ch, '自動語音房：無人使用');
  parking.add(ch.id);
  try {
    // 先藏起來再清聊天，清的過程中不會有人闖進來看到舊訊息
    await ch.edit({ permissionOverwrites: idleOverwrites(guild, botId) });
    if (ch.members.size) {
      // 收回途中剛好有人被搬進來：房間已經藏起來了，把房內的人補回權限，這間照常使用
      await Promise.all([...ch.members.keys()].map(uid => ch.permissionOverwrites.edit(uid, {
        ViewChannel: true, Connect: true, Speak: true, SendMessages: true, ReadMessageHistory: true
      }).catch(() => {})));
      created.add(ch.id);
      return;
    }
    if (!(await wipeChat(ch))) return dropRoom(ch, '自動語音房：聊天紀錄無法完整清除');
    // 改成待用名稱，免得管理員看到一串舊老闆的名字；額度不夠就先不改，反正沒人看得到
    if (ch.name !== IDLE_NAME && canRename(ch.id)) {
      noteRename(ch.id);
      await ch.setName(IDLE_NAME).catch(() => {});
    }
    created.delete(ch.id);
    idle.set(ch.id, Date.now());
  } catch (e) {
    // 收不回來就別留著，避免藏著一間權限不明的房
    await dropRoom(ch, '自動語音房：收回失敗');
  } finally {
    parking.delete(ch.id);
  }
}

/** 找一間可以馬上沿用的待用房（有改名額度、裡面沒人）；找不到回 null */
function takeIdle(guild) {
  for (const id of idle.keys()) {
    const ch = guild.channels.cache.get(id);
    if (!ch) { if (!guild.client.channels.cache.has(id)) idle.delete(id); continue; }
    if (ch.members.size) { idle.delete(id); continue; }
    if (!canRename(id)) continue;
    idle.delete(id);   // 同步拿走，兩個人同時進大廳也不會搶到同一間
    return ch;
  }
  return null;
}

// 上線時整理分類底下沒人的自建房（多半是上一次重啟留下的）：留下幾間當待用，其餘刪掉
async function sweepEmpty(client) {
  for (const guild of client.guilds.cache.values()) {
    const cat = getSetting('category_voice', '', guild.id);
    if (!cat) continue;
    for (const ch of guild.channels.cache.values()) {
      if (!isAutoRoom(ch) || ch.members.size) continue;
      assumeRenamed(ch.id);
      await parkRoom(ch, client.user.id);
    }
  }
}

function attach(client) {
  client.once(Events.ClientReady, () => sweepEmpty(client).catch(() => {}));
  client.on(Events.VoiceStateUpdate, async (before, after) => {
    try {
      // 進入大廳 → 給一間房並把人搬進去
      const guild = after.guild || before.guild;
      const hub = getSetting('channel_voice_hub', '', guild?.id);
      if (hub && after.channelId === hub && after.member) {
        const parent = getSetting('category_voice', '', guild.id) || after.channel.parentId;
        // 預設私人房；要開成公開房可在後台「自動語音房 → 房間是否私人」改成公開
        const isPrivate = getSetting('voice_room_private', '1', guild.id) !== '0';
        // 名稱格式可在後台改（voice_room_name），{name} 會換成使用者暱稱
        const name = roomTemplate(guild.id).replace('{name}', after.member.displayName).slice(0, 90);
        const overwrites = isPrivate
          ? privateOverwrites(guild, after.member.id, client.user.id)
          : publicOverwrites(after.member.id, client.user.id);

        let room = takeIdle(guild);
        if (room) {
          // 權限與房間設定一次換掉（這個呼叫不含改名，不受改名額度限制）；
          // 上一位老闆若改過人數上限或音質，也在這裡還原
          await room.edit({ permissionOverwrites: overwrites, userLimit: 0, bitrate: 64000 });
          // 改名另外送、不等它：權限已經換好了，名字晚一點出現也不會讓人看到不該看的
          noteRename(room.id);
          room.setName(name).catch(() => {});
          created.add(room.id);
        } else {
          room = await guild.channels.create({
            name, type: ChannelType.GuildVoice,
            parent: parent || undefined,
            permissionOverwrites: overwrites
          });
          created.add(room.id);
        }
        await after.member.voice.setChannel(room).catch(() => {});
      }

      // 被客服搬進私人房的陪玩：Discord 的語音內建聊天室要有 ViewChannel 才看得到，
      // 但私人房把 @everyone 的 ViewChannel 關掉了，陪玩人在房裡卻看不到聊天室。
      // 進來時補一份個人權限（含發言、看歷史），離開時再收回，房間本身仍然是私人的。
      if (after.channelId && after.channelId !== before.channelId
          && after.member && isAutoRoom(after.channel) && !idle.has(after.channelId)
          // 房主建房時就給過權限（含 ManageChannels），再 edit 一次會把那份蓋掉
          && !after.channel.permissionOverwrites.cache.get(after.member.id)) {
        await after.channel.permissionOverwrites.edit(after.member.id, {
          ViewChannel: true, Connect: true, Speak: true,
          SendMessages: true, ReadMessageHistory: true
        }).catch(() => {});
      }

      const left = before.channel;
      if (!left || before.channelId === after.channelId || !isAutoRoom(left)) return;

      // 最後一人離開 → 收回（收回時整份權限會重設，不必逐一撤銷）
      if (left.members.size === 0) {
        await parkRoom(left, client.user.id);
        return;
      }
      // 還有人在：把剛離開那位的臨時權限收回（房主的那份是建房時給的，不動）
      const own = left.permissionOverwrites.cache.get(before.member?.id);
      if (own && !own.allow.has(F.ManageChannels)) {
        await left.permissionOverwrites.delete(before.member.id).catch(() => {});
      }
    } catch (e) {
      console.warn('語音房處理失敗：', e.message);
    }
  });
}

module.exports = {
  attach,
  // 測試用
  _test: { parkRoom, takeIdle, wipeChat, canRename, noteRename, idle, created, renames, IDLE_NAME }
};
