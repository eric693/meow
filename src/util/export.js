// 匯出引擎：同一份「欄位定義 + 資料列」可輸出 CSV / Excel / PDF
// 欄位定義格式：{ key, label, width, num?, map? }
const path = require('path');
const fs = require('fs');

// PDF 中文字型（Noto Sans CJK TC，系統內建）
const CJK_TTC = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
const CJK_PS = 'NotoSansCJKtc-Regular';
const hasCJK = fs.existsSync(CJK_TTC);

const cell = (col, row) => {
  const v = row[col.key];
  return col.map ? col.map(v, row) : (v == null ? '' : v);
};

// ---------------- CSV ----------------
function toCSV(columns, rows) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(c => esc(c.label)).join(',')];
  for (const r of rows) {
    lines.push(columns.map(c => {
      const v = cell(c, r);
      // Discord ID 這種長數字用 ="..." 包住，Excel 才不會轉成科學記號（對齊公司既有檔案）
      if (c.key === 'user_id' || c.key === 'staff_id' || c.key === 'customer_id') return `="${v}"`;
      return esc(v);
    }).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

// ---------------- Excel ----------------
async function toXLSX(columns, rows, { title = '報表', sheet = '資料', summary = null } = {}) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = '喚雨機器喵';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: summary ? 3 : 1 }] });

  let headerRowIdx = 1;
  if (summary) {
    const t = ws.addRow([title]);
    t.font = { bold: true, size: 14 };
    ws.mergeCells(1, 1, 1, columns.length);
    const s = ws.addRow([summary]);
    s.font = { color: { argb: 'FF6B6B85' }, size: 10 };
    ws.mergeCells(2, 1, 2, columns.length);
    headerRowIdx = 3;
  }

  const header = ws.addRow(columns.map(c => c.label));
  header.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9B6DD6' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFD8CCEC' } } };
  });
  ws.getRow(headerRowIdx).height = 22;

  for (const r of rows) {
    const line = ws.addRow(columns.map(c => {
      const v = cell(c, r);
      return c.num ? Number(v) || 0 : String(v);
    }));
    line.eachCell((c, i) => {
      const col = columns[i - 1];
      if (col.num) { c.numFmt = '#,##0'; c.alignment = { horizontal: 'right' }; }
      c.border = { bottom: { style: 'hair', color: { argb: 'FFEDE7F6' } } };
    });
  }

  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 14; });
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: columns.length }
  };
  return wb.xlsx.writeBuffer();
}

// ---------------- PDF ----------------
function toPDF(columns, rows, { title = '報表', subtitle = '', landscape = true } = {}) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 28 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const F = hasCJK ? 'cjk' : 'Helvetica';
    if (hasCJK) doc.registerFont('cjk', CJK_TTC, CJK_PS);

    const left = doc.page.margins.left;
    const usable = doc.page.width - left - doc.page.margins.right;
    const totalW = columns.reduce((a, c) => a + (c.width || 14), 0);
    const widths = columns.map(c => (c.width || 14) / totalW * usable);

    doc.font(F).fontSize(16).fillColor('#4b3a6b').text(title, left, doc.page.margins.top);
    if (subtitle) doc.fontSize(9).fillColor('#7c7391').text(subtitle);
    doc.moveDown(0.5);

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y - 2, usable, 18).fill('#9b6dd6');
      doc.fillColor('#ffffff').fontSize(8.5);
      let x = left;
      columns.forEach((c, i) => {
        doc.text(String(c.label), x + 3, y + 3, { width: widths[i] - 6, align: c.num ? 'right' : 'left', lineBreak: false });
        x += widths[i];
      });
      doc.y = y + 20;
      doc.fillColor('#2b2440');
    };
    drawHeader();

    doc.fontSize(8);
    let zebra = false;
    for (const r of rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 26) {
        doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 28 });
        doc.font(F);
        drawHeader();
        doc.fontSize(8);
      }
      const y = doc.y;
      if (zebra) doc.rect(left, y - 2, usable, 15).fill('#f6f2fc').fillColor('#2b2440');
      zebra = !zebra;
      let x = left;
      columns.forEach((c, i) => {
        let v = cell(c, r);
        if (c.num) v = Number(v || 0).toLocaleString('en-US');
        doc.fillColor('#2b2440').text(String(v), x + 3, y + 1,
          { width: widths[i] - 6, align: c.num ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + 15;
    }

    doc.moveDown(0.6);
    doc.fontSize(8).fillColor('#7c7391')
      .text(`共 ${rows.length} 筆・由喚雨機器喵後台產生於 ${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' })}`,
        left, doc.y);
    doc.end();
  });
}

/** Express 回應：依 format 輸出 csv / xlsx / pdf */
async function sendExport(res, format, { columns, rows, filename, title, subtitle, summary }) {
  const safe = String(filename || 'export').replace(/[^\w.-]/g, '_');
  if (format === 'xlsx') {
    const buf = await toXLSX(columns, rows, { title, sheet: title, summary });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.xlsx"`);
    return res.end(Buffer.from(buf));
  }
  if (format === 'pdf') {
    const buf = await toPDF(columns, rows, { title, subtitle: subtitle || summary || '' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    return res.end(buf);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.csv"`);
  res.send(toCSV(columns, rows));
}

module.exports = { toCSV, toXLSX, toPDF, sendExport, hasCJK };
