// 自動播報：VIP 升級等會員狀態變化
const { db, orgOf } = require('../db');
const { emb, COLOR, mention } = require('./embed');
const { vipName } = require('./reports');

/**
 * 播報頻道的設定要用「開單的那個群」去查，但金流函式內部早就把 guildId 換成 org_id 了
 * （抽成、VIP 門檻這類設定是整個組織共用的）。org_id 底下沒有頻道設定，
 * 結果就是 VIP 升級、金流備份通通默默不發——升到 VIP 2 也沒人看到。
 * 這裡改成：先看這個群自己的設定；只有「完全沒設定過這個 key」才往同組織的其他群找。
 * 設過但留空＝老闆刻意關掉播報，要尊重，不能拿別的群的頻道來頂。
 */
function channelSetting(key, guildId) {
  const own = db.prepare('SELECT value FROM settings WHERE guild_id=? AND key=?').get(guildId, key);
  if (own) return own.value;
  const org = orgOf(guildId);
  const rows = db.prepare(`SELECT s.value FROM settings s
      WHERE s.key=? AND s.value<>'' AND (s.guild_id=? OR s.guild_id IN
        (SELECT guild_id FROM guild_org WHERE org_id=?))`).all(key, org, org);
  return rows.length ? rows[0].value : '';
}

/** VIP 升級播報到「VIP 升級播報」頻道；沒設定就不發 */
async function vipUpgraded(guildId, userId, from, to) {
  try {
    const id = channelSetting('channel_vip_announce', guildId);
    if (!id) return;
    const client = require('../bot').getClient();
    if (!client) return;
    const ch = await client.channels.fetch(id).catch(e => { throw new Error(`取不到頻道 ${id}：${e.message}`); });
    if (!ch || !ch.isTextBased?.()) throw new Error(`頻道 ${id} 不是文字頻道`);
    await ch.send(`${mention(userId)} 的 VIP 等級已從 **${vipName(guildId, from)}** 升級至 **${vipName(guildId, to)}** 🎉`);
  } catch (e) {
    // 播報失敗不能影響金流，但要留下痕跡——之前整段吞掉，沒發也沒人知道為什麼
    console.warn('VIP 升級播報失敗：', e.message);
  }
}

/**
 * 財務事件備份：發到「金流紀錄頻道」，沒設就退回後台財務頻道。
 * 退單這種會動到錢的操作，不管從 Discord 還是後台做的都要留一份在頻道裡。
 */
async function financeLog(guildId, embed) {
  try {
    const id = channelSetting('channel_money_log', guildId)
      || channelSetting('channel_finance', guildId);
    if (!id) return false;
    const client = require('../bot').getClient();
    if (!client) return false;
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch || !ch.isTextBased?.()) return false;
    await ch.send({ embeds: [embed] });
    return true;
  } catch { return false; }   // 備份失敗不能影響金流本身
}

module.exports = { vipUpgraded, financeLog, channelSetting };
