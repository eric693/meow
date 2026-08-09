// 指令權限判定
// 身分組 ID 在後台「系統設定」填寫；沒設定時退回「伺服器管理權限」。
const { PermissionsBitField } = require('discord.js');
const { getSetting, getStaff } = require('../db');

const ids = (guildId, key) => getSetting(key, '', guildId).split(',').map(s => s.trim()).filter(Boolean);
const hasRole = (member, list) => list.some(r => member.roles.cache.has(r));

const isOwnerish = member =>
  member.permissions.has(PermissionsBitField.Flags.Administrator) ||
  member.permissions.has(PermissionsBitField.Flags.ManageGuild);

/** 管理員：Administrator/ManageGuild，或設定的管理身分組 */
function isAdmin(member) {
  if (!member) return false;
  const list = ids(member.guild.id, 'role_admin');
  return isOwnerish(member) || (list.length > 0 && hasRole(member, list));
}

/** 客服：管理員一律通過 */
function isCS(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  const list = ids(member.guild.id, 'role_cs');
  if (list.length && hasRole(member, list)) return true;
  const s = getStaff(member.guild.id, member.id);
  return !!(s && s.active && s.kind === 'cs');
}

/** 陪玩：在 staff 表且 active */
function isPlayer(member) {
  if (!member) return false;
  const s = getStaff(member.guild.id, member.id);
  if (s && s.active && s.kind === 'player') return true;
  const list = ids(member.guild.id, 'role_player');
  return list.length > 0 && hasRole(member, list);
}

module.exports = { isAdmin, isCS, isPlayer, roleIds: ids };
