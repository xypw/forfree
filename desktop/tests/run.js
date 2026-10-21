'use strict';
/* 运行器：node tests/run.js  [--filter=关键字] */
const fs = require('fs');
const path = require('path');
const { boot, resetStorage } = require('./harness');
const { cases } = require('./t');

const filterArg = process.argv.find((a) => a.indexOf('--filter=') === 0);
const filter = filterArg ? filterArg.slice(9) : null;

// 载入所有 *.test.js（它们通过 require('./t') 注册用例）
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
for (const f of files) require(path.join(__dirname, f));

(async () => {
  const t0 = Date.now();
  let app;
  try {
    app = boot({ keep: true });
  } catch (e) {
    console.error('✗ 应用加载失败：' + e.message);
    process.exit(1);
  }
  const bootMs = Date.now() - t0;

  const picked = filter ? cases.filter((c) => c.name.indexOf(filter) >= 0) : cases;
  if (!picked.length) {
    console.error('没有匹配的用例' + (filter ? '（filter=' + filter + '）' : ''));
    process.exit(1);
  }

  console.log('加载应用 ' + bootMs + ' ms · 脚本 ' + files.length + ' 个测试文件 · ' + picked.length + ' 个用例\n');

  const fails = [];
  for (const c of picked) {
    resetStorage(app);          // 每个用例从干净的存储开始，互不影响
    try {
      await c.fn(app);
      console.log('  ✓ ' + c.name);
    } catch (e) {
      console.log('  ✗ ' + c.name);
      fails.push({ name: c.name, err: e });
    }
  }

  const pass = picked.length - fails.length;
  if (fails.length) {
    console.log('\n失败详情：');
    for (const f of fails) {
      console.log('\n  【' + f.name + '】');
      const msg = (f.err && f.err.message) || String(f.err);
      console.log('    ' + msg.split('\n').slice(0, 12).join('\n    '));
    }
  }
  console.log('\n' + pass + ' 通过 / ' + fails.length + ' 失败 · ' + (Date.now() - t0) + ' ms');
  process.exit(fails.length ? 1 : 0);
})();
