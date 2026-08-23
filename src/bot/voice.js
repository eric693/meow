// 自動語音房：進入「創建語音房」頻道就開一間專屬語音，最後一人離開自動刪除
const { ChannelType, PermissionsBitField, Events } = require('discord.js');
const { getSetting } = require('../db');
const { roleIds } = require('./perm');

const F = PermissionsBitField.Flags;

// 機器人這次上線期間建立的房間，避免誤刪既有頻道
const created = new Set();

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
    { id: botId, allow: [F.ViewChannel, F.Connect, F.MoveMembers, F.ManageChannels] }
  ];
}

function publicOverwrites(ownerId) {
  return [{ id: ownerId, allow: [F.ManageChannels, F.MoveMembers, F.Connect, F.Speak] }];
}

function attach(client) {
  client.on(Events.VoiceStateUpdate, async (before, after) => {
    try {
      // 進入大廳 → 開房並把人搬進去
      const guild = after.guild || before.guild;
      const hub = getSetting('channel_voice_hub', '', guild?.id);
      if (hub && after.channelId === hub && after.member) {
        const parent = getSetting('category_voice', '', guild.id) || after.channel.parentId;
        // 預設私人房；要開成公開房可在後台「自動語音房 → 房間是否私人」改成公開
        const isPrivate = getSetting('voice_room_private', '1', guild.id) !== '0';
        const room = await guild.channels.create({
          // 名稱格式可在後台改（voice_room_name），{name} 會換成使用者暱稱
          name: (getSetting('voice_room_name', '', guild.id) || '{name} 老闆的專屬語音')
            .replace('{name}', after.member.displayName).slice(0, 90),
          type: ChannelType.GuildVoice,
          parent: parent || undefined,
          permissionOverwrites: isPrivate
            ? privateOverwrites(guild, after.member.id, client.user.id)
            : publicOverwrites(after.member.id)
        });
        created.add(room.id);
        await after.member.voice.setChannel(room).catch(() => {});
      }

      // 被客服搬進私人房的陪玩：Discord 的語音內建聊天室要有 ViewChannel 才看得到，
      // 但私人房把 @everyone 的 ViewChannel 關掉了，陪玩人在房裡卻看不到聊天室。
      // 進來時補一份個人權限（含發言、看歷史），離開時再收回，房間本身仍然是私人的。
      if (after.channelId && after.channelId !== before.channelId
          && created.has(after.channelId) && after.member) {
        await after.channel.permissionOverwrites.edit(after.member.id, {
          ViewChannel: true, Connect: true, Speak: true,
          SendMessages: true, ReadMessageHistory: true
        }).catch(() => {});
      }
      // 離開房間就把剛才補的個人權限收回（房主的那份是建房時給的，不動）
      if (before.channelId && before.channelId !== after.channelId
          && created.has(before.channelId) && before.member && before.channel) {
        const owner = before.channel.permissionOverwrites.cache.get(before.member.id);
        if (owner && !owner.allow.has(F.ManageChannels)) {
          await before.channel.permissionOverwrites.delete(before.member.id).catch(() => {});
        }
      }

      // 離開自建房且已無人 → 刪除
      const left = before.channel;
      if (left && created.has(left.id) && left.members.size === 0) {
        created.delete(left.id);
        await left.delete().catch(() => {});
      }
    } catch (e) {
      console.warn('語音房處理失敗：', e.message);
    }
  });
}

module.exports = { attach };
