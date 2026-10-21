'use strict';
/* 文档对比：LCS 行级 diff。纯逻辑，最该被单测覆盖的一块。 */
const { test, eq, ok } = require('./t');
const { get } = require('./harness');

const st = (left, right, ic, is) => {
  const { window } = get();
  const rows = window.DIFF.compute(left, right, !!ic, !!is);
  return { rows, s: window.DIFF.stats(rows) };
};

test('diff：完全相同的两份 → 全部 same', () => {
  const { s } = st('a\nb\nc', 'a\nb\nc');
  eq(s.same, 3);
  eq(s.add, 0);
  eq(s.del, 0);
  eq(s.mod, 0);
});

test('diff：纯新增', () => {
  const { s } = st('a\nb', 'a\nb\nc');
  eq(s.add, 1);
  eq(s.del, 0);
});

test('diff：纯删除', () => {
  const { s } = st('a\nb\nc', 'a\nc');
  eq(s.del, 1);
  eq(s.add, 0);
});

test('diff：修改一行应识别为 mod，而不是 add+del', () => {
  const { s } = st('a\nb\nc', 'a\nB2\nc');
  eq(s.mod, 1, '修改没被识别成 mod');
  eq(s.same, 2);
});

test('diff：ignoreCase 生效', () => {
  const { s } = st('a\nB\nc', 'a\nb\nc', true, false);
  eq(s.mod, 0, '忽略大小写后不该有修改');
  eq(s.same, 3);
});

test('diff：ignoreSpace 生效', () => {
  const { s } = st('a\n  b  \nc', 'a\nb\nc', false, true);
  eq(s.mod, 0, '忽略空白后不该有修改');
  eq(s.same, 3);
});

test('diff：插入在中间时后面的行仍能对齐', () => {
  const { s } = st('1\n2\n3', '1\nX\n2\n3');
  eq(s.add, 1);
  eq(s.same, 3);
  eq(s.del, 0);
});

test('diff：空文本不出错', () => {
  const { s } = st('', '');
  // 空文档 = 0 行（见 splitLines 里的说明），否则空 vs 有内容会被判成"修改"
  eq(s.total, 0);
  eq(s.same, 0);
  const r2 = st('', 'a\nb').s;
  eq(r2.add, 2);
  const r3 = st('a\nb', '').s;
  eq(r3.del, 2);
});

test('diff：stats 的 total 等于各项之和', () => {
  const { s } = st('a\nb\nc\nd', 'a\nB\nc\ne');
  eq(s.total, s.same + s.add + s.del + s.mod);
});

test('diff：docToPlain 把 HTML 转成按行文本', () => {
  const { window } = get();
  const txt = window.DIFF.docToPlain({ type: 'doc', data: { html: '<h1>标题</h1><p>第一段</p><p>第二段</p>' } });
  ok(txt.indexOf('标题') >= 0, '标题丢了');
  ok(txt.indexOf('第一段') >= 0);
  ok(txt.indexOf('第二段') >= 0);
  ok(txt.split('\n').length >= 3, '段落没被拆成多行');
});
