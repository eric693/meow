// 共用嵌入訊息樣式
const { EmbedBuilder } = require('discord.js');
const { getSetting, orgOf } = require('../db');

const COLOR = { main: 0xc9a7eb, ok: 0x57f287, warn: 0xfee75c, err: 0xed4245, money: 0xf1c40f };

const brand = guildId => getSetting('brand_name', '喚雨', orgOf(guildId));

function emb(guildId, { title, desc, color = COLOR.main, fields = [], footer, image, thumbnail }) {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTimestamp();
  if (title) e.setTitle(title);
  if (desc) e.setDescription(desc);
  if (fields.length) e.addFields(fields);
  if (image) e.setImage(image);
  if (thumbnail) e.setThumbnail(thumbnail);
  e.setFooter({ text: footer || `${brand(guildId)}・喚雨機器喵` });
  return e;
}

/** 是不是可以直接內嵌顯示的圖片網址（Discord CDN 連結會帶一長串過期參數，要先去掉）*/
const isImageUrl = url => /^https?:\/\//i.test(String(url || ''))
  && /\.(png|jpe?g|gif|webp)$/i.test(String(url).split('?')[0]);

const ok = (guildId, title, desc, fields) => emb(guildId, { title: '✅ ' + title, desc, color: COLOR.ok, fields });
const err = (guildId, desc) => emb(guildId, { title: '⚠️ 無法完成', desc, color: COLOR.err });
const money = (guildId, title, desc, fields) => emb(guildId, { title, desc, color: COLOR.money, fields });

const n = v => Number(v || 0).toLocaleString('en-US');
const mention = id => `<@${id}>`;

module.exports = { emb, ok, err, money, COLOR, n, mention, brand, isImageUrl };
