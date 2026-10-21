'use strict';
/* 模板库：33 套模板的完整性与结构。
   模板是最容易被「改了一处数据结构、某几套悄悄变空」影响的地方。 */
const { test, eq, ok } = require('./t');
const { get } = require('./harness');

test('模板库：共 33 套，类型分布 13 / 10 / 10', () => {
  const { window } = get();
  const T = window.TEMPLATES;
  eq(T.all.length, 33);
  eq(T.byType('doc').length, 13);
  eq(T.byType('sheet').length, 10);
  eq(T.byType('slide').length, 10);
});

test('模板库：每套的 key / name / type / build 都齐全', () => {
  const { window } = get();
  const seen = new Set();
  for (const t of window.TEMPLATES.all) {
    ok(t.key, '有模板缺 key');
    ok(!seen.has(t.key), '模板 key 重复：' + t.key);
    seen.add(t.key);
    ok(t.name, t.key + ' 缺 name');
    ok(['doc', 'sheet', 'slide'].indexOf(t.type) >= 0, t.key + ' 的 type 非法：' + t.type);
    eq(typeof t.build, 'function', t.key + ' 没有 build()');
  }
});

test('模板库：每套都能 build 出非空、结构正确的数据', () => {
  const { window } = get();
  for (const t of window.TEMPLATES.all) {
    const data = t.build();
    ok(data && typeof data === 'object', t.name + ' 的 build() 没返回对象');
    if (t.type === 'doc') {
      ok(typeof data.html === 'string' && data.html.length > 20, t.name + ' 正文为空或过短');
    } else if (t.type === 'sheet') {
      ok(Array.isArray(data.sheets) && data.sheets.length > 0, t.name + ' 没有工作表');
      const cells = data.sheets[0].cells || {};
      ok(Object.keys(cells).length > 0, t.name + ' 一个单元格都没有');
    } else {
      ok(Array.isArray(data.slides) && data.slides.length > 0, t.name + ' 没有幻灯片');
      const shapes = data.slides[0].shapes || [];
      ok(shapes.length > 0, t.name + ' 首页没有任何元素');
    }
  }
});

test('模板库：find 能按 key 找到，未知 key 返回假值', () => {
  const { window } = get();
  const T = window.TEMPLATES;
  for (const t of T.all) ok(T.find(t.key), 'find 找不到 ' + t.key);
  ok(!T.find('__不存在的模板__'), '未知 key 应返回假值');
});

test('模板库：use 真的创建文档并落库', () => {
  const { window } = get();
  const T = window.TEMPLATES, S = window.FW.Store;
  const t = T.byType('doc')[0];
  const d = T.use(t.key);
  ok(d, 'use 返回空');
  eq(d.title, t.name);
  eq(d.type, 'doc');
  ok(S.get(d.id), 'use 之后没进文档库');
});

test('模板库：演示模板 build 出来的数据能直接生成 pptx', () => {
  const { window } = get();
  const T = window.TEMPLATES, O = window.OFFICE;
  const t = T.byType('slide')[0];
  const doc = { id: 'x', type: 'slide', title: t.name, data: t.build() };
  if (!doc.data.size) doc.data.size = { w: 960, h: 540 };
  const bytes = O.buildPptx(doc);
  ok(bytes && bytes.length > 1000, 'pptx 太小：' + (bytes && bytes.length));
  const files = Object.keys(window.fflate.unzipSync(bytes));
  ok(files.indexOf('ppt/presentation.xml') >= 0, '生成的 pptx 缺 presentation.xml');
});

test('模板库：文字模板 build 出来的数据能直接生成 docx', () => {
  const { window } = get();
  const T = window.TEMPLATES, O = window.OFFICE;
  const t = T.byType('doc')[0];
  const doc = { id: 'y', type: 'doc', title: t.name, data: t.build() };
  const bytes = O.buildDocx(doc);
  ok(bytes && bytes.length > 800, 'docx 太小');
  const files = Object.keys(window.fflate.unzipSync(bytes));
  ok(files.indexOf('word/document.xml') >= 0, '生成的 docx 缺 document.xml');
});
