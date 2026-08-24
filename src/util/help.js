// 指令總覽（!指令 / !help / /help 共用同一份內容）
// 內建這份是預設值；後台「指令表文案」改過之後，改以 settings.help_sections 為準。
const { emb } = require('./embed');
const { getSetting, setSetting, orgOf, audit } = require('../db');

const SITE = 'https://meow.crownai.ink';

const DEFAULT_SECTIONS = [
  { name: '💳 金流操作（客服／管理員）',
    value: '`!結帳 @老闆 陪玩 原價 [折抵]` — 選券→選付款方式（現金／雨幣）→發結帳明細\n'
         + '`!核銷 訂單編號` `!未銷` `!儲值 @老闆 金額 匯款後五碼` `!扣款 @老闆 金額`\n'
         + '`!退單 編號 [原因]`（客服）　`!提領 金額`（陪玩本人）\n'
         + '`!發券 @老闆 名稱 100`（或 `20%`，可加 `滿1000` `到2026-12-31` `x3`）\n'
         + '`!取消報單 訂單編號` — 清掉報單紀錄，讓陪玩重報（陪玩本人或客服）' },

  { name: '📊 查詢與統計',
    value: '`!消費查詢 [@老闆]` `!薪資查詢 [@陪玩]` — 查自己免權限，查他人限客服\n'
         + '`!查點單 @老闆` `!雨幣查詢 @老闆` `!業績查詢` `!客服業績 [起日 迄日]`（客服）\n'
         + '`!消費榜` `!全服雨幣` — 全員可用' },

  { name: '🏷️ 冠名與身份組期限（客服）',
    value: '`/冠名 名稱 客人 陪玩 天數 [接棒] [開始] [備註]` — 接棒＝排在該陪玩最晚一筆之後\n'
         + '`/身份組 名稱 對象 天數 [開始] [備註]`　`/冠名列表 [類別] [關鍵字]`\n'
         + '`/結束冠名 編號` — 開始與到期會自動發提醒到冠名播報頻道，並標客服身分組\n'
         + '（`!冠名` `!身份組` `!冠名列表` `!結束冠名` 也還能用）' },

  { name: '📤 報表與匯出（客服）',
    value: '`!週結 [起日]` — 該週每位陪玩該領多少（依**核銷日**計，附 CSV）\n'
         + '`!財務報表` `!匯出報表` `!匯出消費總表` `!匯出提領報表`' },

  { name: '🔮 喚雨星象（全員）',
    value: '`!抽籤` / `/抽籤` — 每天一次的運勢抽籤，抽中吉籤會掉折價券進背包\n'
         + '（客服：`!setup-lottery` 建面板，獎項與機率在後台「投票與意見箱」頁調整）' },

  { name: '🧑‍💼 營運與人事',
    value: '`!結單` — 在訂單包廂裡打＝收掉這張單（歸檔、鎖發言、1 天後刪頻道）；\n'
         + '　 在其他頻道打＝發「今日已結單」公告\n'
         + '`!刷新人事` `!離職 名稱`（客服）　`!清空客服業績`（客服，不可復原）\n'
         + '`!指令` `!手冊` — 全員可用' },

  { name: '⌨️ 斜線指令 — 財務結帳',
    value: '`/結帳 客人 陪玩 金額 [原價] [項目] [備註]` — 選折價券→選付款方式→發結帳明細\n'
         + '`/身分組結帳 客人 陪玩 項目 單價 [數量]` — 免核銷，分潤直接入可提領\n'
         + '`/伺服器冠名結帳 老闆 金額` — 抽成 0，100% 進伺服器淨利\n'
         + '`/儲值 對象 金額 匯款憑證` `/扣款 對象 金額`（客服）\n'
         + '`/提領 陪玩 金額` — 客服直接發薪\n'
         + '`/退單 訂單編號 [退還雨幣] [原因]` — 回沖薪資與羈絆，可選擇不退幣\n'
         + '`/補單 客人 陪玩 金額 [日期]` — 只補帳本，不動雨幣餘額\n'
         + '`/財務調整 金額 原因` — 平帳專用（客服）' },

  { name: '⌨️ 斜線指令 — 其他',
    value: '`/入職` `/親密調整` `/vip等級` `/送禮`（可套用背包折價券）\n'
         + '`/對帳` `/陪玩業績詳報` `/新增地盤` `/發布投票`（以上皆客服可用）\n'
         + '`/愛戀查詢` `/背包查詢` `/help`（全員）' },

  { name: '⚙️ 面板建置（客服）',
    value: '`!setup-checkout` 客服結帳台　`!setup-ticket` 派單接待大廳\n'
         + '`!setup-report` 自主報單　`!setup-report-cross` `!setup-report-cross-2` 跨服報單\n'
         + '`!setup-exam` 考核入職　`!setup-member` 會員服務中心　`!setup-bank` 地下金庫\n'
         + '`!setup-intimacy` 愛戀藏館\n'
         + '`!setup-suggestion` 意見箱　`!setup-staff-suggestion` 員工輔導室\n'
         + '`!setup-lottery` 喚雨星象抽籤\n'
         + '`!setup-identity` 身份大廳　`!sendrole` 身分組領取　`!sendorder` 下單前提醒' },

  { name: '🧾 結帳流程',
    value: '**1.** 客服在主群 `!結帳` 或 `/結帳` → 選券、選付款方式後產生 `ORD-` 編號\n'
         + '**2.** 陪玩憑編號在員工群報單、補對局截圖\n'
         + '**3.** 客服 `!核銷 ORD-…` → 暫存薪水轉入可提領\n'
         + '**4.** 陪玩 `!提領 金額` → 管理員後台審核撥款\n'
         + '➡️ 同一間包廂可以結好幾次帳（不同陪玩、多筆訂單都行），\n'
         + '　 結帳**不會**自動結單；要收單請按「結束此訂單／關閉訂單」' }
];

const DEFAULT_TITLE = '📖 喚雨機器喵 指令總覽';
const DEFAULT_DESC = `完整說明與後台管理：${SITE}\n所有機器人指令客服身分組都可以使用；權限不足時會回覆「你沒有使用這個指令的權限」，請向管理員確認身分組。`;

// Discord 對 embed 欄位有硬性上限，後台存進來的文案一定要先裁切，
// 否則整則 /help 會被 API 退回、變成完全發不出來。
const CAP = { name: 256, value: 1024, title: 256, desc: 4096 };
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

/** 目前生效的指令表（後台改過就用後台的，否則用內建預設） */
function getHelp(guildId) {
  const raw = getSetting('help_sections', '', orgOf(guildId));
  let custom = null;
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p.sections) && p.sections.length) custom = p;
    } catch { /* 存壞了就當作沒改過，至少 /help 還發得出來 */ }
  }
  return {
    custom: !!custom,
    title: clip(custom?.title || DEFAULT_TITLE, CAP.title),
    desc: clip(custom?.desc ?? DEFAULT_DESC, CAP.desc),
    sections: (custom?.sections || DEFAULT_SECTIONS)
      .filter(x => x && (x.name || x.value))
      .map(x => ({ name: clip(x.name, CAP.name), value: clip(x.value, CAP.value) }))
      .slice(0, 25)      // embed 最多 25 個欄位
  };
}

/** 後台儲存；傳 null 代表還原成內建預設 */
function saveHelp(guildId, data, operator = '') {
  const gid = orgOf(guildId);
  if (!data) setSetting('help_sections', '', gid);
  else setSetting('help_sections', JSON.stringify({
    title: clip(data.title, CAP.title),
    desc: clip(data.desc, CAP.desc),
    sections: (data.sections || []).filter(x => x && (x.name || x.value))
      .map(x => ({ name: clip(x.name, CAP.name), value: clip(x.value, CAP.value) })).slice(0, 25)
  }), gid);
  audit(operator, data ? '修改指令表文案' : '還原指令表文案', '', gid, { source: 'settings' });
  return getHelp(gid);
}

/** 指令總覽嵌入訊息 */
const helpEmbed = guildId => {
  const h = getHelp(guildId);
  return emb(guildId, { title: h.title, desc: h.desc, fields: h.sections });
};

module.exports = {
  helpEmbed, getHelp, saveHelp, SITE,
  DEFAULT_SECTIONS, DEFAULT_TITLE, DEFAULT_DESC,
  // 舊的具名匯出還有地方在用，指向目前生效的內容
  get SECTIONS() { return getHelp('').sections; }
};
