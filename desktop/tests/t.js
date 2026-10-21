'use strict';
/* 极简测试框架：不引第三方，够用就行 */
const assert = require('assert');

const cases = [];

function test(name, fn) { cases.push({ name, fn }); }
function eq(actual, expected, msg) { assert.deepStrictEqual(actual, expected, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function throws(fn, msg) { assert.throws(fn, msg); }
function includes(hay, needle, msg) {
  assert.ok(String(hay).indexOf(needle) >= 0, msg || ('期望包含 ' + needle + '，实际：' + String(hay).slice(0, 200)));
}

module.exports = { test, eq, ok, throws, includes, cases };
