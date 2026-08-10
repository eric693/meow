// Slash 指令定義（對應附圖）
const { SlashCommandBuilder } = require('discord.js');

const b = (name, desc) => new SlashCommandBuilder().setName(name).setDescription(desc);

const commands = [
  // ---- 說明 ----
  b('help', '顯示喚雨機器喵的全部指令與權限說明')
    .addBooleanOption(o => o.setName('公開').setDescription('讓整個頻道都看得到，預設只有你看得到')),

  // ---- 財務與結帳 ----
  b('結帳', '一般結帳：選折價券與付款方式，計算拆帳與親密度並發布結帳明細')
    .addUserOption(o => o.setName('客人').setDescription('請標記金主').setRequired(true))
    .addStringOption(o => o.setName('陪玩').setDescription('請標記服務陪玩').setRequired(true))
    .addIntegerOption(o => o.setName('金額').setDescription('客人實付金額').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('原價').setDescription('未折扣前的訂單原價，不填視為與實付相同').setMinValue(0))
    .addStringOption(o => o.setName('項目').setDescription('例：娛樂4場、唱歌2小時'))
    .addStringOption(o => o.setName('備註').setDescription('寫進流水帳的備註')),

  b('身分組結帳', '身分組專屬結帳（如獨顯-週／獨顯-月），完成後免核銷')
    .addUserOption(o => o.setName('客人').setDescription('付款的老闆').setRequired(true))
    .addStringOption(o => o.setName('陪玩').setDescription('陪玩代號／藝名／@提及').setRequired(true))
    .addStringOption(o => o.setName('項目').setDescription('例：獨顯-週、獨顯-月').setRequired(true))
    .addIntegerOption(o => o.setName('單價').setDescription('單份金額').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('數量').setDescription('預設 1').setMinValue(1))
    .addStringOption(o => o.setName('備註').setDescription('寫進流水帳的備註')),

  b('伺服器冠名結帳', '100% 收益直接歸入伺服器淨利的特殊結帳')
    .addUserOption(o => o.setName('老闆').setDescription('付款的老闆').setRequired(true))
    .addIntegerOption(o => o.setName('金額').setDescription('結帳金額').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('項目').setDescription('例：伺服器冠名-8月'))
    .addStringOption(o => o.setName('備註').setDescription('寫進流水帳的備註')),

  b('儲值', '為金主手動增加雨幣餘額')
    .addUserOption(o => o.setName('對象').setDescription('請選擇要儲值的金主').setRequired(true))
    .addIntegerOption(o => o.setName('金額').setDescription('輸入儲值數量 (純數字)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('原因').setDescription('例：轉帳儲值、活動補償')),

  b('扣款', '手動扣除金主帳戶的雨幣餘額')
    .addUserOption(o => o.setName('對象').setDescription('請選擇要扣款的金主').setRequired(true))
    .addIntegerOption(o => o.setName('金額').setDescription('輸入扣除數量 (純數字)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('原因').setDescription('例：重複儲值更正')),

  b('提領', '發放薪資給陪玩，並從其可提領帳戶中扣除')
    .addStringOption(o => o.setName('陪玩').setDescription('陪玩代號／藝名／@提及').setRequired(true))
    .addIntegerOption(o => o.setName('金額').setDescription('發放金額').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('備註').setDescription('例：匯款帳號末五碼')),

  b('退單', '撤銷訂單或禮物，只要輸入編號即可自動回溯！')
    .addStringOption(o => o.setName('訂單編號').setDescription('例：ORD-63876816').setRequired(true))
    .addBooleanOption(o => o.setName('退還雨幣').setDescription('是否將「客人實付」金額退還至金主雨幣帳戶？'))
    .addStringOption(o => o.setName('原因').setDescription('退單原因')),

  b('補單', '於底層帳本補登歷史紀錄（不影響實際雨幣餘額）')
    .addUserOption(o => o.setName('客人').setDescription('老闆').setRequired(true))
    .addStringOption(o => o.setName('陪玩').setDescription('陪玩代號／藝名／@提及').setRequired(true))
    .addIntegerOption(o => o.setName('金額').setDescription('補登金額').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('項目').setDescription('例：娛樂4場'))
    .addStringOption(o => o.setName('日期').setDescription('YYYY-MM-DD，不填視為今天'))
    .addStringOption(o => o.setName('備註').setDescription('寫進流水帳的備註')),

  b('財務調整', '手動調整伺服器本月淨利潤（平帳專用）')
    .addIntegerOption(o => o.setName('金額').setDescription('正數增加淨利、負數減少').setRequired(true))
    .addStringOption(o => o.setName('原因').setDescription('平帳原因').setRequired(true)),

  b('發放折價券', '發送折價券或代金券到金主的背包')
    .addUserOption(o => o.setName('老闆').setDescription('請選擇要發放的金主').setRequired(true))
    .addStringOption(o => o.setName('類型').setDescription('請選擇折價券類型').setRequired(true)
      .addChoices({ name: '金額折抵 (如: 折 50 元)', value: 'amount' },
                  { name: '打折券 (如: 打 85 折)', value: 'percent' }))
    .addIntegerOption(o => o.setName('數值').setDescription('金額折抵填元數；打折券填折數（85 折填 85）')
      .setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('名稱').setDescription('券的名稱，例：VIP2 折價卷').setRequired(true))
    .addIntegerOption(o => o.setName('數量').setDescription('預設 1 張').setMinValue(1))
    .addIntegerOption(o => o.setName('門檻').setDescription('最低消費門檻，不填為無門檻').setMinValue(0))
    .addStringOption(o => o.setName('期限').setDescription('到期日 YYYY-MM-DD，不填為不限期')),

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
