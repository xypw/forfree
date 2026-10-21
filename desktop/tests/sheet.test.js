'use strict';
/* 公式引擎：tokenizer + 递归下降解析器。
   这是表格的核心，出错用户会直接算错数，而且很难肉眼发现。 */
const { test, eq, ok } = require('./t');
const { get } = require('./harness');

const ev = (formula, cells) => {
  const { window } = get();
  return window.FW.Formula.eval(formula, cells || {});
};
const val = (f, c) => ev(f, c).v;

test('公式：四则运算与优先级', () => {
  eq(val('=1+2'), 3);
  eq(val('=2*3+4'), 10);
  eq(val('=2+3*4'), 14);
  eq(val('=(2+3)*4'), 20);
  eq(val('=10/4'), 2.5);
  eq(val('=10-2-3'), 5);
});

test('公式：负号与百分号', () => {
  eq(val('=-5+3'), -2);
  eq(val('=50%'), 0.5);
  eq(val('=200*10%'), 20);
});

test('公式：单元格引用', () => {
  const cells = { '0,0': { v: 10 }, '1,0': { v: 20 }, '0,1': { v: 5 } };
  eq(val('=A1+A2', cells), 30);
  eq(val('=A1*B1', cells), 50);
});

test('公式：区域引用与 SUM', () => {
  const cells = { '0,0': { v: 1 }, '1,0': { v: 2 }, '2,0': { v: 3 }, '3,0': { v: 4 } };
  eq(val('=SUM(A1:A4)', cells), 10);
  eq(val('=SUM(A1:A4)*2', cells), 20);
});

test('公式：SUM 忽略空单元格与非数字', () => {
  const cells = { '0,0': { v: 1 }, '1,0': { v: '' }, '2,0': { v: '文字' }, '3,0': { v: 3 } };
  eq(val('=SUM(A1:A4)', cells), 4);
});

test('公式：AVERAGE / MIN / MAX / COUNT', () => {
  const cells = { '0,0': { v: 2 }, '1,0': { v: 4 }, '2,0': { v: 6 } };
  eq(val('=AVERAGE(A1:A3)', cells), 4);
  eq(val('=MIN(A1:A3)', cells), 2);
  eq(val('=MAX(A1:A3)', cells), 6);
  eq(val('=COUNT(A1:A3)', cells), 3);
});

test('公式：链式引用（A1 引用 B1，B1 是公式）', () => {
  const cells = { '0,0': { f: '=B1*2' }, '0,1': { f: '=C1+1' }, '0,2': { v: 5 } };
  eq(val('=A1', cells), 12);   // C1=5 → B1=6 → A1=12
});

test('公式：循环引用返回 #CIRC! 而不是死循环', () => {
  const cells = { '0,0': { f: '=A2' }, '1,0': { f: '=A1' } };
  const r = ev('=A1', cells);
  eq(r.err, '#CIRC!');
});

test('公式：除以零返回错误而不是 Infinity', () => {
  const r = ev('=1/0');
  ok(r.err, '除零应返回错误，实际 v=' + r.v);
});

test('公式：文本连接 &', () => {
  const cells = { '0,0': { v: '张' }, '0,1': { v: '三' } };
  eq(val('=A1&B1', cells), '张三');
  eq(val('="编号"&A1', cells), '编号张');
});

test('公式：比较运算', () => {
  const cells = { '0,0': { v: 5 }, '0,1': { v: 3 } };
  eq(val('=A1>B1', cells), true);
  eq(val('=A1<B1', cells), false);
  eq(val('=A1=B1', cells), false);
});

test('公式：ISBLANK / ISNUMBER / ISTEXT', () => {
  const cells = { '0,0': { v: '' }, '0,1': { v: 5 }, '0,2': { v: '文字' } };
  eq(val('=ISBLANK(A1)', cells), true);
  eq(val('=ISNUMBER(B1)', cells), true);
  eq(val('=ISTEXT(C1)', cells), true);
  eq(val('=ISNUMBER(C1)', cells), false);
});

test('公式：TEXT / VALUE 转换', () => {
  const cells = { '0,0': { v: 123 } };
  eq(val('=TEXT(A1)', cells), '123');
  eq(val('=VALUE("42")'), 42);
});

test('公式：非法公式返回 #ERROR! 而不是抛异常', () => {
  const r = ev('=1+');
  ok(r.err, '非法公式应返回错误');
  const r2 = ev('=SUM(');
  ok(r2.err, '未闭合括号应返回错误');
});

test('公式：引用不存在的单元格当作空值', () => {
  eq(val('=Z99'), '');
  eq(val('=Z99+1'), 1);
});

test('公式：colName / colIndex 与 office 的保持一致', () => {
  const { window } = get();
  const F = window.FW.Formula, O = window.OFFICE;
  for (let i = 0; i < 60; i++) {
    eq(F.colName(i), O.colName(i), '第 ' + i + ' 列名不一致');
    eq(F.colIndex(F.colName(i)), i);
  }
});
