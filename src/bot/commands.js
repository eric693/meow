// Slash 指令定義（對應附圖）
const { SlashCommandBuilder } = require('discord.js');

const b = (name, desc) => new SlashCommandBuilder().setName(name).setDescription(desc);

const commands = [
  // ---- 查詢與報表 ----
  b('對帳', '查詢特定老闆在特定陪玩身上的累計消費金額與次數')
    .addUserOption(o => o.setName('客人').setDescription('老闆').setRequired(true))
    .addStringOption(o => o.setName('陪玩').setDescription('陪玩代號／藝名／@提及').setRequired(true)),

  b('陪玩業績詳報', '查詢特定陪玩師的金主分布結構與總業績（Top 10）')
    .addStringOption(o => o.setName('陪玩').setDescription('陪玩代號／藝名／@提及').setRequired(true)),

  // ---- 互動與福利 ----
  b('送禮', '發送禮物，自動扣款並計算雙倍親密度')
    .addUserOption(o => o.setName('送禮人').setDescription('付款的老闆').setRequired(true))
    .addStringOption(o => o.setName('對象').setDescription('收禮的陪玩').setRequired(true))
    .addStringOption(o => o.setName('禮物款式').setDescription('禮物名稱或代號').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('數量').setDescription('預設 1').setMinValue(1)),

  b('愛戀查詢', '查詢老闆與陪玩的親密羈絆點數與特權進度')
    .addStringOption(o => o.setName('陪玩').setDescription('陪玩代號／藝名／@提及').setRequired(true))
    .addUserOption(o => o.setName('客人').setDescription('不填則查自己')),

  b('親密調整', '強制調整某對 CP 的親密度（歸零時同步清除歷史禮物紀錄）')
    .addUserOption(o => o.setName('客人').setDescription('老闆').setRequired(true))
    .addStringOption(o => o.setName('陪玩').setDescription('陪玩代號／藝名／@提及').setRequired(true))
    .addIntegerOption(o => o.setName('點數').setDescription('正數增加、負數減少；設 0 請用 -999999').setRequired(true)),

  b('vip等級', '手動強制設定老闆的 VIP 等級（0~7）')
    .addUserOption(o => o.setName('老闆').setDescription('老闆').setRequired(true))
    .addIntegerOption(o => o.setName('等級').setDescription('0~7，設 -1 解除鎖定改回自動')
      .setRequired(true).setMinValue(-1).setMaxValue(7)),

  b('背包查詢', '查詢老闆目前的專屬背包狀態與折價券明細')
    .addUserOption(o => o.setName('客人').setDescription('不填則查自己')),

  b('新增地盤', '新增老闆的地盤步數進度（超過 21 會自動歸 0）')
    .addUserOption(o => o.setName('老闆').setDescription('老闆').setRequired(true))
    .addIntegerOption(o => o.setName('數值').setDescription('增加的步數').setRequired(true)),

  b('發布投票', '快速發布匿名的選擇題投票與賽前競猜箱')
    .addStringOption(o => o.setName('標題').setDescription('投票主題').setRequired(true))
    .addStringOption(o => o.setName('選項').setDescription('用「、」或「,」分隔，最多 10 個').setRequired(true)),

  // ---- 人事 ----
  b('入職', '錄取陪玩並綁定對應的影音名片')
    .addUserOption(o => o.setName('對象').setDescription('要錄取的成員').setRequired(true))
    .addStringOption(o => o.setName('代號').setDescription('員工代號').setRequired(true))
    .addStringOption(o => o.setName('名稱').setDescription('藝名').setRequired(true))
    .addStringOption(o => o.setName('網址').setDescription('影音名片網址'))
    .addStringOption(o => o.setName('職務').setDescription('陪玩 或 客服')
      .addChoices({ name: '陪玩', value: 'player' }, { name: '客服', value: 'cs' }))
].map(c => c.toJSON());

module.exports = { commands };
