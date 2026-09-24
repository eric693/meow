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

/**
 * 是不是 Discord 按鈕能用的表情。
 * 兩種合法：伺服器自訂表情 `<:name:id>` / `<a:name:id>`，或真正的 unicode 表情。
 * 填到別的東西（例如「2」或一段文字）Discord 會退掉整則訊息，所以要先擋掉。
 */
const isEmoji = v => {
  const x = String(v == null ? '' : v).trim();
  if (!x) return false;
  if (/^<a?:[\w~]{2,32}:\d{15,25}>$/.test(x)) return true;
  // 表情本體可能由多個碼位組成（膚色、ZWJ 組合、國旗、數字鍵帽）
  return /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*])[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\uFE0F\u20E3\p{Emoji_Modifier}]*$/u.test(x)
    && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(x);
};

/** 網址的副檔名（Discord CDN 連結會帶一長串過期參數，要先去掉）*/
const extOf = url => (String(url || '').split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const isHttp = url => /^https?:\/\//i.test(String(url || ''));

/** 可以直接內嵌顯示的圖片 */
const isImageUrl = url => isHttp(url) && ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extOf(url));
/** 影片：embed 放不了播放器，要用附件重新上傳 Discord 才會給原生播放器 */
const isVideoUrl = url => isHttp(url) && ['mp4', 'mov', 'webm', 'm4v'].includes(extOf(url));

const ok = (guildId, title, desc, fields) => emb(guildId, { title: '✅ ' + title, desc, color: COLOR.ok, fields });
const err = (guildId, desc) => emb(guildId, { title: '⚠️ 無法完成', desc, color: COLOR.err });
const money = (guildId, title, desc, fields) => emb(guildId, { title, desc, color: COLOR.money, fields });

const n = v => Number(v || 0).toLocaleString('en-US');
const mention = id => `<@${id}>`;

module.exports = { emb, ok, err, money, COLOR, n, mention, brand, isImageUrl, isVideoUrl, extOf, isEmoji };
