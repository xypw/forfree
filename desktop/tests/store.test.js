'use strict';
/* 文档库：增删改查、回收站、历史版本、整库备份。
   这一层是「用户数据」的唯一落点，出问题就是丢数据，优先级最高。 */
const { test, eq, ok } = require('./t');
const { get } = require('./harness');

function newDoc(FW, title, type) {
  const d = FW.createDoc(type || 'doc');
  d.title = title || '未命名';
  return d;
}

test('upsert / get / list：新建后能查到，重复 upsert 不会产生两条', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc');
  d.title = '甲';
  ok(Store.upsert(d), 'upsert 应返回文档对象');
  eq(Store.list().length, 1);
  eq(Store.get(d.id).title, '甲');

  d.title = '甲（改）';
  Store.upsert(d);
  eq(Store.list().length, 1, '重复 upsert 变成了两条');
  eq(Store.get(d.id).title, '甲（改）');
});

test('upsert：会刷新 updated 时间戳', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc');
  d.updated = 1000;
  Store.upsert(d);
  ok(Store.get(d.id).updated > 1000, 'updated 没被刷新');
});

test('remove：删掉就查不到', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc');
  Store.upsert(d);
  Store.remove(d.id);
  eq(Store.get(d.id), null);
  eq(Store.list().length, 0);
});

test('回收站：删除进回收站 → 还原 → 再删除 → 彻底清除', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc');
  d.title = '要删的';
  Store.upsert(d);

  Store.trashDoc(d.id);
  eq(Store.get(d.id), null, '移入回收站后不该还能从文档列表查到');
  eq(Store.trashList().length, 1);
  eq(Store.trashList()[0].title, '要删的');

  Store.restore(d.id);
  ok(Store.get(d.id), '还原失败');
  eq(Store.trashList().length, 0);

  Store.trashDoc(d.id);
  Store.purge(d.id);
  eq(Store.trashList().length, 0, '彻底删除后回收站应为空');
});

test('回收站：emptyTrash 清空但不影响正常文档', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const keep = createDoc('doc'); keep.title = '保留';
  const gone = createDoc('doc'); gone.title = '清掉';
  Store.upsert(keep); Store.upsert(gone);
  Store.trashDoc(gone.id);
  Store.emptyTrash();
  eq(Store.trashList().length, 0);
  ok(Store.get(keep.id), '清空回收站误删了正常文档');
});

test('duplicate：副本是新 id，标题带「副本」', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc');
  d.title = '原件';
  Store.upsert(d);
  const c = Store.duplicate(d.id);
  ok(c, 'duplicate 返回空');
  ok(c.id !== d.id, '副本 id 没变');
  eq(c.title, '原件 副本');
  eq(Store.list().length, 2);
});

test('历史版本：快照 → 列出 → 还原', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc');
  d.title = 'v1';
  d.data.html = '<p>第一版</p>';
  Store.upsert(d);

  Store.snapshot(d, '手动', { force: true });
  ok(Store.versionCount(d.id) >= 1, '快照没存进去');

  d.data.html = '<p>第二版</p>';
  Store.upsert(d);

  const list = Store.versions(d.id);
  ok(list.length >= 1, '版本列表为空');
  const ts = list[0].ts;
  const v = Store.getVersion(d.id, ts);
  ok(v, '取不到指定版本');
  eq(JSON.parse(v.data).html, '<p>第一版</p>', '版本内容不对');
});

test('整库备份：exportAll 结构完整，importAll 能补回被删的文档', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const a = createDoc('doc'); a.title = 'A'; Store.upsert(a);
  const b = createDoc('sheet'); b.title = 'B'; Store.upsert(b);
  Store.trashDoc(b.id);
  Store.trashDoc(b.id);
  const backup = Store.exportAll();

  eq(backup.app, 'forfree');
  eq(backup.kind, 'backup');
  eq(backup.version, 1);
  eq(backup.docs.length, 1, '备份里的文档数不对');
  ok(Array.isArray(backup.trash), 'trash 不是数组');
  ok(backup.versions && typeof backup.versions === 'object', 'versions 不是对象');

  Store.remove(a.id);
  eq(Store.list().length, 0);
  const r = Store.importAll(backup, 'merge');
  ok(r.ok, '导入失败：' + r.error);
  ok(Store.get(a.id), '导入后文档没回来');
});

test('整库备份：重复导入是幂等的（不产生重复文档）', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc'); d.title = 'A'; Store.upsert(d);
  const backup = Store.exportAll();
  const r1 = Store.importAll(backup, 'merge');
  const r2 = Store.importAll(backup, 'merge');
  eq(r1.added, 0);
  eq(r2.added, 0);
  eq(Store.list().length, 1);
});

test('整库备份：非法文件被拒绝，且不会破坏现有数据', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc'); d.title = 'A'; Store.upsert(d);

  for (const bad of [null, {}, { app: 'forfree' }, { kind: 'backup' }, { app: 'other', kind: 'backup', docs: [] }, { app: 'forfree', kind: 'backup', docs: 'x' }]) {
    const r = Store.importAll(bad, 'merge');
    eq(r.ok, false, '非法输入应被拒绝：' + JSON.stringify(bad));
  }
  eq(Store.list().length, 1, '拒绝非法导入时把数据弄丢了');
});

test('设置：setSetting / settings 往返', () => {
  const { window } = get();
  const { Store } = window.FW;
  Store.setSetting('autoOpenLast', true);
  eq(Store.settings().autoOpenLast, true);
  Store.setSetting('autoOpenLast', false);
  eq(Store.settings().autoOpenLast, false);
});

test('存储用量：usage 返回各分项数字', () => {
  const { window } = get();
  const { Store, createDoc } = window.FW;
  const d = createDoc('doc'); Store.upsert(d);
  const u = Store.usage();
  ok(typeof u === 'number' && u > 0, 'usage 应返回总字节数，实际：' + u);
});
