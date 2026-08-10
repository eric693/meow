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

module.exports = { vipUpgraded };
