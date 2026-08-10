// 自動語音房：進入「創建語音房」頻道就開一間專屬語音，最後一人離開自動刪除
const { ChannelType, PermissionsBitField, Events } = require('discord.js');
const { getSetting } = require('../db');

// 機器人這次上線期間建立的房間，避免誤刪既有頻道
const created = new Set();

function attach(client) {
  client.on(Events.VoiceStateUpdate, async (before, after) => {
    try {
      // 進入大廳 → 開房並把人搬進去
      const hub = getSetting('channel_voice_hub', '', after.guild?.id || before.guild?.id);
      if (hub && after.channelId === hub && after.member) {
        const parent = getSetting('category_voice', '', after.guild.id) || after.channel.parentId;
        const room = await after.guild.channels.create({
          name: `${after.member.displayName} 老闆的專屬語音`.slice(0, 90),
          type: ChannelType.GuildVoice,
          parent: parent || undefined,
          permissionOverwrites: [
            { id: after.member.id,
              allow: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MoveMembers,
                      PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] }
          ]
        });
        created.add(room.id);
        await after.member.voice.setChannel(room).catch(() => {});
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
