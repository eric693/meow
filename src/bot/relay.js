// 名片專區 → 老闆訂單頻道的即時轉播
// 匿名單的陪玩在名片專區聊天、貼名片，老闆看不到那個頻道，
// 所以這裡把內容原樣轉一份到老闆的包廂，收單刪頻道後紀錄也還在。
const { Events } = require('discord.js');
const { db, orgOf } = require('../db');
const { emb, COLOR } = require('../util/embed');

const IMG = /\.(png|jpe?g|gif|webp)$/i;

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
      const image = files.find(a => IMG.test(a.name || a.url));
      const others = files.filter(a => a !== image);

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

      await boss.send({
        embeds: [body],
        // 非圖片附件（例如影片、壓縮檔）附上連結，避免內容漏掉
        content: others.length ? others.map(a => a.url).join('\n') : undefined
      });
    } catch (e) {
      console.warn('名片專區轉播失敗：', e.message);
    }
  });
}

module.exports = { attach };
