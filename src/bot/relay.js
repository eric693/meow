// 名片專區 → 老闆訂單頻道的即時轉播
// 匿名單的陪玩在名片專區聊天、貼名片，老闆看不到那個頻道，
// 所以這裡把內容原樣轉一份到老闆的包廂，收單刪頻道後紀錄也還在。
const { Events } = require('discord.js');
const { db, orgOf } = require('../db');
const { emb, COLOR, isImageUrl, isVideoUrl } = require('../util/embed');

function attach(client) {
  client.on(Events.MessageCreate, async msg => {
    try {
      if (!msg.guild || msg.author.bot || msg.system) return;

      // 這則訊息是不是發在某張單的名片專區？
      const t = db.prepare(`SELECT * FROM tickets
                            WHERE guild_id=? AND card_channel_id=? AND status!='closed'`)
        .get(orgOf(msg.guildId), msg.channelId);
      if (!t || !t.channel_id || t.channel_id === msg.channelId) return;

      const boss = await msg.guild.channels.fetch(t.channel_id).catch(() => null);
      if (!boss || !boss.isTextBased?.()) return;

      const files = [...msg.attachments.values()];
      const isImg = a => isImageUrl(a.name || a.url) || /^image\//.test(a.contentType || '');
      const isVid = a => isVideoUrl(a.name || a.url) || /^video\//.test(a.contentType || '');
      const image = files.find(isImg);
      // 影片重新上傳成附件，老闆那邊才有播放器可以直接看
      const videos = files.filter(isVid);
      const others = files.filter(a => a !== image && !videos.includes(a));

      const body = emb(msg.guildId, {
        desc: msg.content || (files.length ? '（附件）' : '（無內容）'),
        color: COLOR.main,
        footer: `來自名片專區 · 單號 ${t.seq || t.id}`
      });
      body.setAuthor({
        name: msg.member?.displayName || msg.author.username,
        iconURL: msg.author.displayAvatarURL()
      });
      if (image) body.setImage(image.url);

      const payload = {
        embeds: [body],
        // 其他附件（壓縮檔等）附上連結，避免內容漏掉
        content: others.length ? others.map(a => a.url).join('\n') : undefined
      };
      // 影片檔太大重傳失敗時退回附連結
      await boss.send(videos.length ? { ...payload, files: videos.map(a => a.url) } : payload)
        .catch(() => boss.send({
          ...payload,
          content: [payload.content, ...videos.map(a => a.url)].filter(Boolean).join('\n')
        }));
    } catch (e) {
      console.warn('名片專區轉播失敗：', e.message);
    }
  });
}

module.exports = { attach };
