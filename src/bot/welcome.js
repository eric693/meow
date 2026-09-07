// 新成員進來時在歡迎頻道打招呼
// 頻道與文案都在後台「系統設定」調整；沒設歡迎頻道就整個功能不動作。
const { Events } = require('discord.js');
const { getSetting } = require('../db');
const { emb, COLOR } = require('../util/embed');

const DEFAULT_TITLE = '🛬 貴賓降落！歡迎來到{server}！';
const DEFAULT_TEXT = [
  '▶ 歡迎 {user} 光臨 ◀',
  '',
  '別忘了先到 {roles} 點擊領取您的身份組喔！✨'
].join('\n');

/**
 * 文案可用的變數：
 *   {user}   標記本人　{name} 顯示名稱　{server} 伺服器名稱
 *   {count}  目前成員數　{roles} 身分領取頻道（沒設定就顯示「身分領取」四個字）
 */
function render(text, member, rolesChannelId) {
  return String(text)
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{name}', member.displayName || member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount || ''))
    .replaceAll('{roles}', rolesChannelId ? `<#${rolesChannelId}>` : '「身分領取」');
}

/** 組出歡迎訊息；沒設歡迎頻道時回傳 null（代表不發） */
function welcomePayload(guildId, member) {
  const chId = getSetting('channel_welcome', '', guildId);
  if (!chId) return null;
  const rolesCh = getSetting('channel_role_claim', '', guildId);
  const title = getSetting('welcome_title', '', guildId) || DEFAULT_TITLE;
  const text = getSetting('welcome_text', '', guildId) || DEFAULT_TEXT;
  return {
    channelId: chId,
    // 內容標記本人，對方才會收到通知；卡片本身走 embed
    content: `<@${member.id}>`,
    embeds: [emb(guildId, {
      title: render(title, member, rolesCh),
      desc: render(text, member, rolesCh),
      color: COLOR.ok,
      thumbnail: member.user.displayAvatarURL?.({ size: 128 })
    })]
  };
}

function attach(client) {
  client.on(Events.GuildMemberAdd, async member => {
    try {
      if (member.user?.bot) return;   // 別對機器人打招呼
      const p = welcomePayload(member.guild.id, member);
      if (!p) return;
      const ch = await member.guild.channels.fetch(p.channelId).catch(() => null);
      if (!ch?.isTextBased?.()) return;
      await ch.send({ content: p.content, embeds: p.embeds });
    } catch (e) {
      console.warn('歡迎訊息發送失敗：', e.message);
    }
  });
}

module.exports = { attach, welcomePayload, render, DEFAULT_TITLE, DEFAULT_TEXT };
