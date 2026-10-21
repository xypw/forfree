'use strict';
/* 多标签：同一个窗口里开多个文档，来回切不用回首页。
   走真实 DOM 点击（标签栏是渲染出来的），不是直接调内部函数。 */
const { test, eq, ok } = require('./t');
const { get, ready } = require('./harness');

const tabNames = (d) => Array.from(d.querySelectorAll('.doc-tab .dt-name')).map((x) => x.textContent).join(',');
const activeName = (d) => {
  const el = d.querySelector('.doc-tab.on .dt-name');
  return el ? el.textContent : null;
};
const barShown = (d) => d.querySelector('#tabBar').style.display !== 'none';

function mkDoc(FW, type, title) {
  const d = FW.createDoc(type);
  d.title = title;
  FW.Store.upsert(d);
  return d;
}

test('多标签：打开两个文档 → 两个标签，后开的激活', async () => {
  const app = get();
  await ready(app);
  const { window } = app;
  const FW = window.FW, d = window.document;

  const a = mkDoc(FW, 'doc', '文档A');
  const b = mkDoc(FW, 'sheet', '表格B');
  FW.app.openDoc(a);
  eq(d.querySelectorAll('.doc-tab').length, 1);
  ok(barShown(d), '标签栏应该显示');

  FW.app.openDoc(b);
  eq(d.querySelectorAll('.doc-tab').length, 2);
  eq(tabNames(d), '文档A,表格B');
  eq(activeName(d), '表格B');
});

test('多标签：点标签能切回去，标题栏跟着变', async () => {
  const app = get();
  await ready(app);
  const { window } = app;
  const FW = window.FW, d = window.document;

  const a = mkDoc(FW, 'doc', '甲');
  const b = mkDoc(FW, 'slide', '乙');
  FW.app.openDoc(a);
  FW.app.openDoc(b);
  eq(activeName(d), '乙');

  d.querySelectorAll('.doc-tab')[0].click();   // 点第一个标签
  eq(activeName(d), '甲');
  eq(d.querySelector('#docTitle').value, '甲');
  eq(FW.app.current(), 'doc');
});

test('多标签：关掉当前标签 → 自动切到相邻的', async () => {
  const app = get();
  await ready(app);
  const { window } = app;
  const FW = window.FW, d = window.document;

  const a = mkDoc(FW, 'doc', '甲');
  const b = mkDoc(FW, 'doc', '乙');
  FW.app.openDoc(a);
  FW.app.openDoc(b);

  d.querySelector('.doc-tab.on .dt-close').click();   // 关掉「乙」
  eq(tabNames(d), '甲');
  eq(activeName(d), '甲', '关掉当前标签后应切到剩下的那个');
});

test('多标签：关掉全部标签 → 回首页且标签栏隐藏', async () => {
  const app = get();
  await ready(app);
  const { window } = app;
  const FW = window.FW, d = window.document;

  FW.app.openDoc(mkDoc(FW, 'doc', '唯一'));
  d.querySelector('.doc-tab.on .dt-close').click();
  eq(d.querySelectorAll('.doc-tab').length, 0);
  ok(!barShown(d), '没有文档时标签栏应隐藏');
  ok(d.querySelector('#view-home').classList.contains('active'), '应回到首页');
});

test('多标签：重复打开同一个文档不会产生第二个标签', async () => {
  const app = get();
  await ready(app);
  const { window } = app;
  const FW = window.FW, d = window.document;

  const a = mkDoc(FW, 'doc', '同一个');
  FW.app.openDoc(a);
  FW.app.openDoc(a);
  FW.app.openDoc(FW.Store.get(a.id));
  eq(d.querySelectorAll('.doc-tab').length, 1, '同一文档被开了多个标签');
});

test('多标签：改名后标签上的名字跟着变', async () => {
  const app = get();
  await ready(app);
  const { window } = app;
  const FW = window.FW, d = window.document;

  const a = mkDoc(FW, 'doc', '旧名字');
  FW.app.openDoc(a);
  d.querySelector('#docTitle').value = '新名字';
  FW.app.save(true);
  eq(tabNames(d), '新名字');
});

test('多标签：PDF 会话不进标签栏', async () => {
  const app = get();
  await ready(app);
  const { window } = app;
  const FW = window.FW, d = window.document;

  FW.app.openPdf(new Uint8Array([1, 2, 3]), '测试.pdf');
  ok(!barShown(d), 'PDF 工作台不该显示文档标签栏');
});
