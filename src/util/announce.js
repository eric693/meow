// 自動播報：VIP 升級等會員狀態變化
const { getSetting, orgOf } = require('../db');
const { emb, COLOR, mention } = require('./embed');
const { vipName } = require('./reports');

/** VIP 升級播報到「VIP 升級播報」頻道；沒設定就不發 */
async function vipUpgraded(guildId, userId, from, to) {
  try {
    const id = getSetting('channel_vip_announce', '', guildId);
    if (!id) return;
    const client = require('../bot').getClient();
    if (!client) return;
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch || !ch.isTextBased?.()) return;
    await ch.send(`${mention(userId)} 的 VIP 等級已從 **${vipName(guildId, from)}** 升級至 **${vipName(guildId, to)}** 🎉`);
  } catch { /* 播報失敗不能影響金流 */ }
}

/**
 * 財務事件備份：發到「金流紀錄頻道」，沒設就退回後台財務頻道。
 * 退單這種會動到錢的操作，不管從 Discord 還是後台做的都要留一份在頻道裡。
 */
async function financeLog(guildId, embed) {
  try {
    const id = getSetting('channel_money_log', '', guildId) || getSetting('channel_finance', '', guildId);
    if (!id) return false;
    const client = require('../bot').getClient();
    if (!client) return false;
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch || !ch.isTextBased?.()) return false;
    await ch.send({ embeds: [embed] });
    return true;
  } catch { return false; }   // 備份失敗不能影響金流本身
}

module.exports = { vipUpgraded, financeLog };
