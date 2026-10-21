'use strict';
/* Office 文件读写：生成 → 解析的往返一致性。
   这几条是回归价值最高的 —— docx/xlsx/pptx 是手写 OOXML，
   改 office.js 时最容易在「能生成但打不开」或「能打开但内容丢」上翻车。 */
const { test, eq, ok, includes } = require('./t');
const { get } = require('./harness');

const docFixture = {
  id: 'd1', type: 'doc', title: '测试标题',
  data: { html: '<h1>大标题</h1><p>第一段</p><p><strong>加粗</strong>与<em>斜体</em></p><ul><li>要点一</li><li>要点二</li></ul>' }
};

const sheetFixture = {
  id: 's1', type: 'sheet', title: '表',
  data: {
    rows: 20, cols: 8,
    sheets: [{
      name: 'Sheet1', rows: 20, cols: 8,
      cells: {
        '0,0': { v: '项目', b: true }, '0,1': { v: '金额', b: true },
        '1,0': { v: '人力' }, '1,1': { v: 5000 },
        '2,0': { v: '差旅' }, '2,1': { v: 1200 },
        '3,0': { v: '合计' }, '3,1': { f: '=SUM(B2:B3)' }
      }
    }]
  }
};

const slideFixture = {
  id: 'l1', type: 'slide', title: '演示',
  data: {
    size: { w: 960, h: 540 }, theme: 'fresh',
    slides: [{
      layout: 'title', bg: null,
      shapes: [
        { id: 'a', type: 'text', x: 80, y: 60, w: 800, h: 90, text: '封面标题', size: 40, color: '#222222' },
        { id: 'b', type: 'text', x: 80, y: 180, w: 800, h: 60, text: '副标题', size: 20, color: '#666666' }
      ]
    }, {
      layout: 'titleContent', bg: null,
      shapes: [{ id: 'c', type: 'text', x: 90, y: 80, w: 780, h: 300, text: '第二页正文', size: 22, color: '#222222' }]
    }]
  }
};

test('docx：生成的是合法 ZIP，且含 Word 必需部件', () => {
  const { window } = get();
  const bytes = window.OFFICE.buildDocx(docFixture);
  ok(bytes && bytes.length > 800, 'docx 太小：' + (bytes && bytes.length));
  const files = Object.keys(window.fflate.unzipSync(bytes));
  ok(files.indexOf('[Content_Types].xml') >= 0, '缺 [Content_Types].xml');
  ok(files.indexOf('word/document.xml') >= 0, '缺 word/document.xml');
  ok(files.indexOf('_rels/.rels') >= 0, '缺 _rels/.rels');
});

test('docx：解析回来正文与格式一致（往返）', () => {
  const { window } = get();
  const back = window.OFFICE.parseDocx(window.OFFICE.buildDocx(docFixture));
  includes(back.html, '大标题');
  includes(back.html, '第一段');
  includes(back.html, '加粗');
  includes(back.html, '<strong>', '加粗格式丢了');
  includes(back.html, '<em>', '斜体格式丢了');
  includes(back.html, '要点一', '列表内容丢了');
});

test('xlsx：生成的是合法 ZIP，且含 Excel 必需部件', () => {
  const { window } = get();
  const bytes = window.OFFICE.buildXlsx(sheetFixture);
  const files = Object.keys(window.fflate.unzipSync(bytes));
  ok(files.indexOf('[Content_Types].xml') >= 0, '缺 [Content_Types].xml');
  ok(files.indexOf('xl/workbook.xml') >= 0, '缺 xl/workbook.xml');
  ok(files.some((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)), '缺工作表 XML');
});

test('xlsx：数值与公式往返不丢', () => {
  const { window } = get();
  const back = window.OFFICE.parseXlsx(window.OFFICE.buildXlsx(sheetFixture));
  eq(back.sheets.length, 1);
  const cells = back.sheets[0].cells;
  eq(cells['0,0'].v, '项目');
  eq(cells['1,1'].v, 5000);
  ok(cells['3,1'], '合计单元格丢了');
  includes(String(cells['3,1'].f || ''), 'SUM', '公式丢了');
});

test('pptx：生成的是合法 ZIP，且含 PowerPoint 必需部件', () => {
  const { window } = get();
  const bytes = window.OFFICE.buildPptx(slideFixture);
  const files = Object.keys(window.fflate.unzipSync(bytes));
  // 这几个缺任何一个，PowerPoint 都会拒绝打开
  ok(files.indexOf('[Content_Types].xml') >= 0, '缺 [Content_Types].xml');
  ok(files.indexOf('ppt/presentation.xml') >= 0, '缺 ppt/presentation.xml');
  ok(files.indexOf('ppt/slideMasters/slideMaster1.xml') >= 0, '缺 slideMaster');
  ok(files.indexOf('ppt/slideLayouts/slideLayout1.xml') >= 0, '缺 slideLayout');
  ok(files.indexOf('ppt/theme/theme1.xml') >= 0, '缺 theme');
  const slides = files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  eq(slides.length, 2, '幻灯片数量不对');
});

test('pptx：每个 slide 的 rId 都在 presentation.xml.rels 里有对应', () => {
  const { window } = get();
  const files = window.fflate.unzipSync(window.OFFICE.buildPptx(slideFixture));
  const dec = (n) => new TextDecoder().decode(files[n]);
  const pres = dec('ppt/presentation.xml');
  const rels = dec('ppt/_rels/presentation.xml.rels');
  const ids = [...pres.matchAll(/r:id="([^"]+)"/g)].map((m) => m[1]);
  ok(ids.length >= 2, 'presentation.xml 里没找到 slide 引用');
  for (const id of ids) {
    includes(rels, 'Id="' + id + '"', '关系 ID ' + id + ' 在 rels 里找不到对应 —— PowerPoint 会拒绝打开');
  }
});

test('csv：导出再导入，单元格内容与转义保持一致', () => {
  const { window } = get();
  const O = window.OFFICE;
  const csv = O.sheetToCsv(sheetFixture.data.sheets[0]);
  includes(csv, '项目');
  includes(csv, '5000');
  const cells = O.csvToCells(csv);
  eq(cells['0,0'].v, '项目');
  eq(cells['1,1'].v, 5000);
});

test('csv：含逗号/引号/换行的字段能正确往返', () => {
  const { window } = get();
  const O = window.OFFICE;
  const sheet = { rows: 5, cols: 5, cells: {
    '0,0': { v: 'a,b' },
    '0,1': { v: 'he said "hi"' },
    '0,2': { v: 'line1\nline2' }
  } };
  const cells = O.csvToCells(O.sheetToCsv(sheet));
  eq(cells['0,0'].v, 'a,b');
  eq(cells['0,1'].v, 'he said "hi"');
  eq(cells['0,2'].v, 'line1\nline2');
});

test('单元格引用：colName / colIndex / refParse / refStr 互逆', () => {
  const { window } = get();
  const O = window.OFFICE;
  eq(O.colName(0), 'A');
  eq(O.colName(25), 'Z');
  eq(O.colName(26), 'AA');
  eq(O.colName(701), 'ZZ');
  eq(O.colIndex('A'), 0);
  eq(O.colIndex('Z'), 25);
  eq(O.colIndex('AA'), 26);
  // 跨 realm 对象不能用 deepStrictEqual（原型不是外层的 Object.prototype），逐字段比
  const bp = O.refParse('B12');
  eq(bp.c, 1); eq(bp.r, 11);
  eq(O.refStr(1, 11), 'B12');
  // 互逆
  for (const ref of ['A1', 'B12', 'AA100', 'ZZ999']) {
    const p = O.refParse(ref);
    eq(O.refStr(p.c, p.r), ref, ref + ' 往返不一致');
  }
});

test('docToText / markdownToHtml：文本导出不丢段落', () => {
  const { window } = get();
  const O = window.OFFICE;
  const txt = O.docToText('<h1>标题</h1><p>正文一</p><p>正文二</p>');
  includes(txt, '标题');
  includes(txt, '正文一');
  includes(txt, '正文二');
  const html = O.markdownToHtml('# 一级\n\n- 甲\n- 乙\n');
  includes(html, '<h1', 'markdown 标题没转成 h1');
  includes(html, '<li>', 'markdown 列表没转成 li');
});
