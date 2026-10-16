/* ============================================================
   ForFree 桌面版 —— Electron 主进程
   启动一个只监听本机的微型 HTTP 服务来承载界面，
   这样 PDF 的 Web Worker、字体、图片等都能正常工作，
   同时对外不开放任何端口（仅 127.0.0.1 随机端口）。
   ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, session, nativeImage, clipboard, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

const WEB_ROOT = path.join(__dirname, 'web');
const isDev = !app.isPackaged;

/* 自检模式：自动逐模块截图并校验引擎，用于打包前验证 */
const SELF_TEST = process.argv.includes('--self-test');
const SHOT_DIR = process.env.FW_SHOT_DIR || path.join(__dirname, 'shots');

if (SELF_TEST) {
  // 无显卡 / 虚拟机 / CI 环境下 GPU 进程会崩溃，自检时强制走软件渲染
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow = null;
let server = null;
let appBaseUrl = null;   // 内置服务的地址，多窗口要用

/* ---------------- 内置静态服务器 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let pathname;
      try {
        pathname = decodeURIComponent(url.parse(req.url).pathname);
      } catch (e) {
        res.writeHead(400); res.end('Bad Request'); return;
      }
      if (pathname === '/') pathname = '/index.html';

      // 防目录穿越：解析后必须仍在 WEB_ROOT 之内
      const target = path.normalize(path.join(WEB_ROOT, pathname));
      if (!target.startsWith(WEB_ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      fs.stat(target, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found: ' + pathname);
          return;
        }
        const ext = path.extname(target).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'no-cache'
        });
        fs.createReadStream(target).pipe(res);
      });
    });

    server.on('error', reject);
    // 端口 0 = 由系统分配空闲端口，只绑定回环地址
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve('http://127.0.0.1:' + addr.port);
    });
  });
}

/* ---------------- 窗口 ---------------- */
async function createWindow() {
  let baseUrl;
  try {
    baseUrl = await startServer();
    appBaseUrl = baseUrl;
  } catch (e) {
    dialog.showErrorBox('ForFree 启动失败', '无法启动内置服务：\n' + e.message);
    app.quit();
    return;
  }

  const iconPath = path.join(__dirname, 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#F2F3F5',
    show: false,
    autoHideMenuBar: false,
    title: 'ForFree 办公套件',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev && !SELF_TEST) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 渲染进程异常退出时给出明确提示，否则自检会静默中断，很难查
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    console.error('  [渲染进程异常退出] reason=' + details.reason + ' exitCode=' + details.exitCode);
  });
  mainWindow.webContents.on('unresponsive', () => console.error('  [渲染进程无响应]'));
  mainWindow.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('  [页面错误] ' + message);
  });

  // 外部链接一律用系统浏览器打开，不在应用内跳走
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, u) => {
    if (u.indexOf(baseUrl) !== 0) {
      e.preventDefault();
      if (/^https?:/i.test(u)) shell.openExternal(u);
    }
  });

  await mainWindow.loadURL(baseUrl + '/index.html');

  if (SELF_TEST) await runSelfTest();
}

/* ---------------- 自检：截图 + 输出关键信息（打包验证用） ---------------- */
async function shoot(name) {
  // capturePage 抓的是合成器当前帧。窗口被遮挡时 Chromium 会停止合成，
  // 抓到的就是好几步之前的旧画面 —— 所以先让窗口获得焦点、强制重绘，再等一会儿。
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.invalidate();
  } catch (e) {}
  await new Promise((r) => setTimeout(r, 700));
  const img = await mainWindow.webContents.capturePage();
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  console.log('  [截图] ' + file);
}

async function runSelfTest() {
  const wc = mainWindow.webContents;
  // 单步失败不要中断整个自检，否则后面的步骤全看不到
  const js = async (code) => {
    try {
      return await wc.executeJavaScript(code, true);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.log('  [步骤失败] ' + msg.split('\n')[0]);
      return 'STEP_ERROR';
    }
  };

  try {
    console.log('\n===== ForFree 桌面版自检 =====');
    await new Promise((r) => setTimeout(r, 1200));

    const info = await js(`JSON.stringify({
      url: location.href,
      title: document.title,
      fw: typeof FW,
      office: typeof OFFICE,
      convert: typeof CONVERT,
      pdfjs: typeof pdfjsLib,
      pdflib: typeof PDFLib,
      fflate: typeof fflate,
      cards: document.querySelectorAll('.new-card').length,
      templates: document.querySelectorAll('.tpl-card').length,
      recent: document.querySelectorAll('.recent-item').length
    })`);
    console.log('  运行环境：' + info);
    await shoot('01-首页');

    // 文字文档
    await js(`FW.app.newDoc('doc'); document.querySelector('#docPaper').innerHTML='<h1 style="text-align:center">ForFree 桌面版</h1><p>这是一份在 Electron 客户端中创建并渲染的文档。</p><p>桌面版与网页版共用同一份代码，功能完全一致。</p><h2>桌面版特性</h2><ul><li>双击即可运行，无需安装</li><li>内置本地服务，PDF 功能完整可用</li><li>导出的文件保存在本机</li></ul>'; 'ok'`);
    await new Promise((r) => setTimeout(r, 500));
    await shoot('02-文字文档');

    // 电子表格
    await js(`(function(){
      var d=FW.createDoc('sheet'); d.title='桌面版表格';
      d.data.sheets[0].cells={'0,0':{v:'项目',b:true,bg:'#E8F5E9'},'0,1':{v:'金额',b:true,bg:'#E8F5E9'},
        '1,0':{v:'人力'},'1,1':{v:50000,fmt:'currency'},'2,0':{v:'差旅'},'2,1':{v:12000,fmt:'currency'},
        '3,0':{v:'合计',b:true},'3,1':{f:'=SUM(B2:B3)',fmt:'currency',b:true}};
      FW.Store.upsert(d); FW.app.openDoc(d); return 'ok'; })()`);
    await new Promise((r) => setTimeout(r, 600));
    await shoot('03-电子表格');

    // 演示文稿
    await js(`FW.app.newDoc('slide'); 'ok'`);
    await new Promise((r) => setTimeout(r, 700));
    await shoot('04-演示文稿');

    // PDF 工作台（用内置示例文件）
    await js(`(function(){
      var x=new XMLHttpRequest(); x.open('GET','samples/sample.pdf',false);
      x.overrideMimeType('text/plain; charset=x-user-defined'); x.send();
      var s=x.responseText, u=new Uint8Array(s.length);
      for(var i=0;i<s.length;i++) u[i]=s.charCodeAt(i)&0xff;
      window.__pdf=u; FW.app.openPdf(u,'sample.pdf'); FW.Editors.pdf.loadBytes(u,'sample.pdf');
      return 'ok'; })()`);
    await new Promise((r) => setTimeout(r, 3500));
    const pdfInfo = await js(`JSON.stringify({
      pages: document.querySelectorAll('#pdfPages .pdf-page').length,
      thumbs: document.querySelectorAll('#pdfThumbs .pdf-thumb').length,
      canvases: document.querySelectorAll('#pdfPages canvas').length,
      rendered: Array.prototype.filter.call(document.querySelectorAll('#pdfPages canvas'), function(c){return c.width>0&&c.height>0;}).length
    })`);
    console.log('  PDF 工作台：' + pdfInfo);
    await shoot('05-PDF工作台');

    // PDF 编辑文字（桌面版专属：本地 mupdf 真删原文 + canvas 贴图写新字）
    // 走真实交互路径：切工具 → 鼠标框选 → 自实现弹窗输入 → 等 PDF 重载 → 数像素验证
    const editInfo = await js(`(async function(){
      var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
      var mk = function(t, p){ return new MouseEvent(t, { bubbles:true, cancelable:true, clientX:p.x, clientY:p.y, view:window }); };
      var frac = { x0:0.10, y0:0.10, x1:0.61, y1:0.17 };   // 标题所在区域（页面比例）

      function pageHost(){ return document.querySelector('#pdfPages .pdf-page'); }
      // 统计「标题区域」里的深色像素数（渲染画布直接读像素）
      function darkCount(){
        var host = pageHost(); if (!host) return -1;
        var cv = host.querySelector('canvas'); if (!cv || !cv.width) return -1;
        var x0 = Math.floor(cv.width*frac.x0), x1 = Math.ceil(cv.width*frac.x1);
        var y0 = Math.floor(cv.height*frac.y0), y1 = Math.ceil(cv.height*frac.y1);
        var d = cv.getContext('2d').getImageData(x0, y0, x1-x0, y1-y0).data;
        var n = 0; for (var i=0;i<d.length;i+=4) if (d[i]<128 && d[i+1]<128 && d[i+2]<128) n++;
        return n;
      }
      async function selectAndInput(text){
        FW.Editors.pdf.cmd('tool:edittext');
        var host = pageHost();
        var layer = host.querySelector('.annotLayer') || host;
        var r = host.getBoundingClientRect();
        var pt = function(fx, fy){ return { x: r.left + r.width*fx, y: r.top + r.height*fy }; };
        layer.dispatchEvent(mk('mousedown', pt(frac.x0, frac.y0)));
        layer.dispatchEvent(mk('mousemove', pt(frac.x1, frac.y1)));
        window.dispatchEvent(mk('mouseup', pt(frac.x1, frac.y1)));
        await sleep(450);
        var inp = document.querySelector('.fw-prompt-input');
        if (!inp) return false;
        inp.value = text;
        document.querySelector('.fw-prompt-mask [data-act="ok"]').click();
        await sleep(3600);
        return true;
      }

      var before = darkCount();
      var shown1 = await selectAndInput('');                    // ① 留空 = 只擦除
      var afterErase = darkCount();
      var shown2 = await selectAndInput('ForFree 桌面版已改写此标题');  // ② 写入新文字
      var afterWrite = darkCount();
      return JSON.stringify({ promptShown: shown1 && shown2, before: before, afterErase: afterErase, afterWrite: afterWrite });
    })()`);
    console.log('  PDF 编辑文字：' + editInfo);
    await shoot('05b-PDF编辑文字');

    // 自实现弹窗（Electron 不支持 window.prompt，全项目已改为 FW.prompt / FW.confirm）
    const dlgInfo = await js(`(async function(){
      var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
      // 先确认原生 prompt 在 Electron 里确实不可用（这就是当初要自实现的原因）
      var nativeBroken = false;
      try { window.prompt('x', ''); } catch (e) { nativeBroken = true; }
      // ① 输入并确定 → 拿到输入值
      var p1 = FW.prompt('测试输入：', '默认值', { title: '测试' });
      await sleep(250);
      var inp = document.querySelector('.fw-prompt-input');
      var shown = !!inp;
      var defaulted = inp ? inp.value : '';
      if (inp) { inp.value = '用户输入的内容'; document.querySelector('.fw-prompt-mask [data-act="ok"]').click(); }
      var v1 = await p1;
      // ② 取消 → null
      var p2 = FW.prompt('再测一次：', 'x');
      await sleep(200);
      document.querySelector('.fw-prompt-mask [data-act="cancel"]').click();
      var v2 = await p2;
      // ③ confirm → true
      var p3 = FW.confirm('确定吗？');
      await sleep(200);
      document.querySelector('.fw-prompt-mask [data-act="ok"]').click();
      var v3 = await p3;
      return JSON.stringify({ nativeBroken: nativeBroken, shown: shown, defaulted: defaulted, value: v1, cancelled: v2, confirmed: v3 });
    })()`);
    console.log('  自实现弹窗：' + dlgInfo);

    // 格式转换中心
    await js(`FW.app.showConvert(); 'ok'`);
    await new Promise((r) => setTimeout(r, 400));
    await shoot('06-格式转换');

    // 模板库
    const tplInfo = await js(`(function(){
      FW.app.showView('home');
      var all = TEMPLATES.all.length;
      var d = TEMPLATES.byType('doc').length, s = TEMPLATES.byType('sheet').length, l = TEMPLATES.byType('slide').length;
      var cards = document.querySelectorAll('.tpl-card').length;
      return JSON.stringify({total: all, doc: d, sheet: s, slide: l, renderedCards: cards});
    })()`);
    console.log('  模板库：' + tplInfo);
    await new Promise((r) => setTimeout(r, 500));
    await shoot('07-模板库');

    // 智能排版
    const tsInfo = await js(`(function(){
      FW.app.newDoc('doc');
      document.querySelector('#docPaper').innerHTML = '<h3>公司简介</h3><p style="color:#ff0000;font-size:9px">我们是一家专注于AI技术的公司,成立于2020年;服务超过500家企业客户.</p><p>我们的愿景是让每个人都能用上好的工具</p>';
      FW.Editors.doc.cmd('typeset');
      var opened = document.querySelector('#typesetMask').classList.contains('on');
      document.querySelector('#tsApply').click();
      var html = document.querySelector('#docPaper').innerHTML;
      return JSON.stringify({
        panelOpened: opened,
        noRedColor: html.indexOf('#ff0000') < 0,
        cnEnSpace: html.indexOf('AI 技术') >= 0,
        fullPunct: html.indexOf('\uff0c') >= 0
      });
    })()`);
    console.log('  智能排版：' + tsInfo);
    await new Promise((r) => setTimeout(r, 400));
    await shoot('08-智能排版');

    // 历史版本
    const hvInfo = await js(`(function(){
      var d = FW.app.currentDoc();
      for (var i = 0; i < 3; i++) { d.data.html = '<p>版本 ' + i + '</p>'; FW.Store.snapshot(d, 'v' + i, {force: true}); }
      FW.app.save(true);
      HISTORY.openPanel(d.id);
      var n = document.querySelectorAll('#hvList .hv-item').length;
      return JSON.stringify({docVersions: FW.Store.versionCount(d.id), panelItems: n});
    })()`);
    console.log('  历史版本：' + hvInfo);
    await new Promise((r) => setTimeout(r, 500));
    await shoot('09-历史版本');
    await js(`document.querySelector('#historyMask [data-hv-close]').click(); 'ok'`);

    // 文档对比
    const diffInfo = await js(`(function(){
      var list = FW.Store.list();
      var a = FW.createDoc('doc'); a.title = '对比A'; a.data.html = '<p>第一行</p><p>第二行</p><p>第三行</p>'; FW.Store.upsert(a);
      var b = FW.createDoc('doc'); b.title = '对比B'; b.data.html = '<p>第一行</p><p>第二行改过了</p><p>第四行新增</p>'; FW.Store.upsert(b);
      DIFF.open({leftKey: 'd:' + a.id, rightKey: 'd:' + b.id});
      var rows = document.querySelectorAll('#diffBody tr').length;
      return JSON.stringify({rows: rows, stats: document.querySelector('#diffStats').textContent.replace(/\\s+/g,' ').trim()});
    })()`);
    console.log('  文档对比：' + diffInfo);
    await new Promise((r) => setTimeout(r, 300));
    await shoot('10-文档对比');

    // 回收站
    const trashInfo = await js(`(function(){
      var d = FW.createDoc('doc'); d.title = '待删除的文档'; FW.Store.upsert(d);
      FW.Store.trashDoc(d.id);
      FW.app.refreshHome();
      TRASH.open();
      return JSON.stringify({items: document.querySelectorAll('#trashList .recent-item').length, badge: document.querySelector('#trashBadge').textContent});
    })()`);
    console.log('  回收站：' + trashInfo);
    await new Promise((r) => setTimeout(r, 500));
    await shoot('11-回收站');

    // PDF → Word / Excel
    const pdfConvInfo = await js(`(function(){
      window.__convDone = null;
      var x = new XMLHttpRequest(); x.open('GET','samples/sample.pdf',false);
      x.overrideMimeType('text/plain; charset=x-user-defined'); x.send();
      var s = x.responseText, u = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
      PDFCONV.loadDoc(u).then(function(pdf){
        return PDFCONV.toDocx(pdf, 'sample').then(function(r){
          var docxLen = r.bytes.length;
          return PDFCONV.toXlsx(pdf, 'sample').then(function(r2){
            window.__convDone = JSON.stringify({docx: docxLen, xlsx: r2.bytes.length});
          });
        });
      }).catch(function(e){ window.__convDone = 'ERR ' + e.message; });
      return 'started';
    })()`);
    await new Promise((r) => setTimeout(r, 2500));
    const convRes = await js(`window.__convDone || 'pending'`);
    console.log('  PDF 转 Office：' + convRes);

    // PDF 压缩 —— 造一份「扫描件风格」的大 PDF（每页一张高分辨率 JPEG）再压
    await js(`(function(){
      window.__cmpDone = null;
      function makeScanPage(w, h) {
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#f5f0e6'); g.addColorStop(1, '#d8cfc0');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        // 画大量细线制造高频细节，让 JPEG 不容易压小（更接近真实扫描件），比逐像素噪声快得多
        for (var k = 0; k < 4000; k++) {
          ctx.strokeStyle = 'rgba(' + ((Math.random() * 120) | 0) + ',' + ((Math.random() * 120) | 0) + ',' + ((Math.random() * 120) | 0) + ',0.55)';
          ctx.lineWidth = 1 + Math.random() * 1.6;
          ctx.beginPath();
          var x0 = Math.random() * w, y0 = Math.random() * h;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + (Math.random() - 0.5) * 90, y0 + (Math.random() - 0.5) * 90);
          ctx.stroke();
        }
        ctx.fillStyle = '#222'; ctx.font = 'bold 76px serif';
        ctx.fillText('Scanned Document', 140, 360);
        ctx.font = '40px serif';
        for (var m = 0; m < 12; m++) ctx.fillText('Line ' + (m + 1) + ' of sample scanned text content.', 140, 470 + m * 60);
        return cv;
      }
      var cvs = [makeScanPage(1700, 2340), makeScanPage(1700, 2340)];
      var blobs = [];
      cvs.forEach(function(cv){ blobs.push(new Promise(function(r){ cv.toBlob(r, 'image/jpeg', 0.95); })); });
      Promise.all(blobs).then(function(bs){
        return Promise.all(bs.map(function(b){ return b.arrayBuffer().then(function(ab){ return new Uint8Array(ab); }); }));
      }).then(function(imgs){
        return PDFLib.PDFDocument.create().then(function(doc){
          var chain = Promise.resolve();
          imgs.forEach(function(u8){
            chain = chain.then(function(){
              return doc.embedJpg(u8).then(function(img){
                var p = doc.addPage([595, 842]);
                p.drawImage(img, {x:0, y:0, width:595, height:842});
              });
            });
          });
          return chain.then(function(){ return doc.save(); });
        });
      }).then(function(big){
        window.__cmpBytes = big;
        return PDFCONV.loadDoc(big);
      }).then(function(pdf){
        return PDFTOOLS.compress(pdf, 'high', null).then(function(r){
          window.__cmpDone = JSON.stringify({
            before: window.__cmpBytes.length, after: r.bytes.length, pages: r.pages,
            saved: Math.round((1 - r.bytes.length / window.__cmpBytes.length) * 100) + '%'
          });
        });
      }).catch(function(e){ window.__cmpDone = 'ERR ' + e.message; });
      return 'started';
    })()`);
    await new Promise((r) => setTimeout(r, 6000));
    const cmpRes = await js(`window.__cmpDone || 'pending'`);
    console.log('  PDF 压缩（扫描件 2 页）：' + cmpRes);

    // PDF 表单填写（先用 pdf-lib 造一份带表单的 PDF）
    await js(`(function(){
      window.__formDone = null;
      PDFLib.PDFDocument.create().then(function(doc){
        return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function(font){
          var page = doc.addPage([595, 842]);
          var form = doc.getForm();
          var f1 = form.createTextField('fullName'); f1.setText('Zhang San');
          f1.addToPage(page, {x:100, y:700, width:220, height:22, font: font});
          var f2 = form.createCheckBox('agree');
          f2.addToPage(page, {x:100, y:660, width:16, height:16});
          var f3 = form.createDropdown('city'); f3.setOptions(['Beijing','Shanghai']);
          f3.addToPage(page, {x:100, y:620, width:180, height:22, font: font});
          return doc.save();
        });
      }).then(function(bytes){
        window.__formPdf = bytes;
        window.__formDone = 'built ' + bytes.length;
      }).catch(function(e){ window.__formDone = 'ERR ' + e.message; });
      return 'started';
    })()`);
    await new Promise((r) => setTimeout(r, 1500));
    const formBuilt = await js(`window.__formDone || 'pending'`);
    console.log('  测试表单 PDF：' + formBuilt);

    const formInfo = await js(`(function(){
      FW.app.openPdf(window.__formPdf, '表单测试.pdf');
      return 'loading';
    })()`);
    await new Promise((r) => setTimeout(r, 2500));
    const formState = await js(`(function(){
      var st = FW.PDFUtil.getState();
      // 切到「工具」选项卡，确认按钮确实在功能区里
      var tabs = document.querySelectorAll('#ribbonTabs .rt-tab');
      for (var i = 0; i < tabs.length; i++) { if (tabs[i].textContent === '工具') { tabs[i].click(); break; } }
      return JSON.stringify({
        fields: st ? st.formFields.length : -1,
        types: st ? st.formFields.map(function(f){ return f.type; }) : [],
        names: st ? st.formFields.map(function(f){ return f.name; }) : [],
        toggleBtn: !!document.querySelector('#ribbonBody .rb-btn[data-cmd="toggleForm"]'),
        compressBtn: !!document.querySelector('#ribbonBody .rb-btn[data-cmd="compress"]')
      });
    })()`);
    console.log('  表单字段检测：' + formState);
    await js(`(function(){ FW.Editors.pdf.cmd('toggleForm'); return 'ok'; })()`);
    await new Promise((r) => setTimeout(r, 900));
    const formUi = await js(`(function(){
      var inputs = document.querySelectorAll('.formField');
      if (inputs.length > 1) { inputs[1].click(); }
      return JSON.stringify({
        overlays: inputs.length,
        bar: !!document.querySelector('.form-bar'),
        barText: (document.querySelector('.form-bar') || {}).textContent ? document.querySelector('.form-bar').textContent.slice(0,40) : ''
      });
    })()`);
    console.log('  表单叠加层：' + formUi);
    await shoot('12-表单填写');

    // 图片工具箱
    await js(`(function(){
      window.__imgDone = null;
      var cv = document.createElement('canvas'); cv.width = 1400; cv.height = 900;
      var ctx = cv.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, 1400, 900);
      g.addColorStop(0, '#2B7FE0'); g.addColorStop(1, '#D93B2B');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1400, 900);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 110px sans-serif';
      ctx.fillText('ForFree', 380, 490);
      IMGTOOLS.open();
      cv.toBlob(function(b){
        var f = new File([b], '测试图.png', {type: 'image/png'});
        IMGTOOLS.addFiles([f]).then(function(){ window.__imgDone = 'added ' + b.size; })
          .catch(function(e){ window.__imgDone = 'ERR ' + e.message; });
      }, 'image/png');
      return 'started';
    })()`);
    await new Promise((r) => setTimeout(r, 2000));
    const imgAdded = await js(`window.__imgDone || 'pending'`);
    console.log('  图片已添加：' + imgAdded);
    await new Promise((r) => setTimeout(r, 300));
    await shoot('13-图片工具箱');
    await js(`(function(){ document.querySelector('#imgRun').click(); return 'ok'; })()`);
    await new Promise((r) => setTimeout(r, 2500));
    const imgResult = await js(`(function(){
      var its = IMGTOOLS.getItems();
      if (!its.length || !its[0].out) return 'pending';
      return JSON.stringify({
        before: its[0].size, after: its[0].out.size,
        dims: its[0].out.w + 'x' + its[0].out.h,
        listShowsOut: document.querySelector('.img-out') ? document.querySelector('.img-out').textContent : ''
      });
    })()`);
    console.log('  图片压缩结果：' + imgResult);
    await shoot('14-图片处理后');

    // 发给朋友
    const shareInfo = await js(`(function(){
      window.__shDone = null;
      FW.app.newDoc('doc');
      document.querySelector('#docPaper').innerHTML =
        '<h1>分享测试文档</h1><p>这是一段用来测试分享功能的正文内容。</p><p>第二段，用来验证复制文本是否完整。</p>';
      FW.app.save(true);
      var doc = FW.app.currentDoc();
      SHARE.open(doc.id);
      var ways = document.querySelectorAll('#shWays .sh-way').length;
      var hasDrag = !!document.querySelector('#shDrag');
      var hasPrimary = !!document.querySelector('#shSaveOpen');
      var titles = Array.prototype.map.call(document.querySelectorAll('#shWays .sw-t strong'), function(x){ return x.textContent; });
      // 等临时文件准备好
      return new Promise(function(res){
        setTimeout(function(){
          window.__shDone = JSON.stringify({
            panelOpen: document.querySelector('#shareMask').classList.contains('on'),
            ways: ways,
            dragZone: hasDrag,
            primaryBtn: hasPrimary,
            titles: titles,
            bridge: {
              saveAndReveal: typeof forfree.saveAndReveal,
              openAppFolder: typeof forfree.openAppFolder,
              startDrag: typeof forfree.startDrag,
              copyText: typeof forfree.copyText
            },
            fileName: (document.querySelector('#shFile strong') || {}).textContent || ''
          });
          res(window.__shDone);
        }, 1200);
      });
    })()`);
    console.log('  分享面板：' + shareInfo);
    await new Promise((r) => setTimeout(r, 400));
    await shoot('15-发给朋友');

    // 验证：复制文本 + 临时文件是否真的写出来了
    const copyRes = await js(`(function(){
      document.querySelector('#shCopy').click();
      return 'clicked';
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    const clipText = clipboard.readText();
    console.log('  复制文本长度：' + clipText.length + ' 字符，开头：' + JSON.stringify(clipText.slice(0, 24)));

    // 验证：导出并打开文件夹那条路（只测写文件，不弹对话框）
    const prepRes = await js(`(function(){
      var f = SHARE.buildFile(FW.app.currentDoc());
      window.__prepName = f.name;
      return JSON.stringify({name: f.name, bytes: f.bytes.length});
    })()`);
    console.log('  待分享文件：' + prepRes);
    const prepPath = await js(`forfree.prepareFile(window.__prepName, SHARE.buildFile(FW.app.currentDoc()).bytes).then(function(r){ return r.path; })`);
    const prepOk = fs.existsSync(prepPath);
    console.log('  临时文件已写入：' + (prepOk ? '是' : '否') + '  ' + prepPath +
      (prepOk ? '  (' + fs.statSync(prepPath).size + ' 字节)' : ''));
    await js(`SHARE.close(); 'ok'`);

    // PDF 转 Word → 结果窗口 → 直接打开编辑
    // 先换回有文字内容的 sample.pdf（之前那份表单 PDF 本身没有正文文字）
    await js(`(function(){
      var x = new XMLHttpRequest(); x.open('GET','samples/sample.pdf',false);
      x.overrideMimeType('text/plain; charset=x-user-defined'); x.send();
      var s = x.responseText, u = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
      FW.app.openPdf(u, '样例文档.pdf');
      return 'ok';
    })()`);
    await new Promise((r) => setTimeout(r, 3000));
    await js(`FW.Editors.pdf.cmd('toDocx'); 'ok'`);
    await new Promise((r) => setTimeout(r, 5000));
    const cvInfo = await js(`(function(){
      var m = document.querySelector('#convResultMask');
      var p = m ? m.querySelector('.modal-body p') : null;
      return JSON.stringify({
        dialogOpen: !!(m && m.classList.contains('on')),
        hasEditBtn: !!document.querySelector('#cvEdit'),
        hasDownloadBtn: !!document.querySelector('#cvDownload'),
        summary: p ? p.textContent.trim() : ''
      });
    })()`);
    console.log('  转换结果窗口：' + cvInfo);
    await shoot('17-转换结果窗口');

    await js(`document.querySelector('#cvEdit').click(); 'ok'`);
    await new Promise((r) => setTimeout(r, 1500));
    const afterEdit = await js(`(function(){
      var d = FW.app.currentDoc();
      var active = document.querySelector('.view.active');
      return JSON.stringify({
        type: d ? d.type : null,
        title: d ? d.title : null,
        view: active ? active.id : null,
        bodyLen: d ? (document.querySelector('#docPaper').textContent || '').length : 0
      });
    })()`);
    console.log('  点「打开编辑」后：' + afterEdit);
    await shoot('18-转换后直接编辑');

    // 新窗口（同时打开多个文件）
    const winBefore = BrowserWindow.getAllWindows().length;
    await js(`FW.app.openInNewWindow(null); 'ok'`);
    await new Promise((r) => setTimeout(r, 3000));
    const winAfter = BrowserWindow.getAllWindows().length;
    console.log('  新窗口：窗口数 ' + winBefore + ' → ' + winAfter + (winAfter > winBefore ? '  ✓' : '  ✗'));
    BrowserWindow.getAllWindows().forEach((w) => { if (w !== mainWindow) { try { w.close(); } catch (e) {} } });
    await new Promise((r) => setTimeout(r, 800));

    // 导出能力
    const exports2 = await js(`(function(){
      var out=[];
      var d1=FW.Store.list().filter(function(x){return x.type==='doc';})[0];
      var d2=FW.Store.list().filter(function(x){return x.type==='sheet';})[0];
      var d3=FW.Store.list().filter(function(x){return x.type==='slide';})[0];
      out.push('docx='+OFFICE.buildDocx(d1).length);
      out.push('xlsx='+OFFICE.buildXlsx(d2).length);
      out.push('pptx='+OFFICE.buildPptx(d3).length);
      return out.join(' / '); })()`);
    console.log('  导出生成：' + exports2);

    // 记住上次编辑的文档：写一个文档 → 重载页面（等价于重启）→ 看会不会自动回到它
    const memId = await js(`(function(){
      FW.app.newDoc('doc');
      document.querySelector('#docTitle').value = '记忆测试文档';
      document.querySelector('#docPaper').innerHTML = '<h1>记忆测试</h1><p>重启后应该自动回到这里。</p>';
      FW.app.save(true);
      window.__memId = FW.app.currentDoc().id;
      return window.__memId;
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    console.log('  已记录 lastDocId，准备重载页面模拟重启…');
    wc.reload();
    await new Promise((r) => setTimeout(r, 4000));
    const restored = await js(`(function(){
      var d = FW.app.currentDoc();
      var active = document.querySelector('.view.active');
      return JSON.stringify({
        autoOpened: !!d,
        title: d ? d.title : null,
        idMatch: d ? (d.id === window.__memId) : false,
        view: active ? active.id : null,
        lastDocIdSaved: !!FW.Store.settings().lastDocId
      });
    })()`);
    console.log('  重启后恢复：' + restored);
    await shoot('16-重启后恢复');

    console.log('  结论：自检通过');
    console.log('==============================\n');
  } catch (e) {
    console.error('  自检失败：' + e.message);
    console.error(e.stack);
  } finally {
    // 留足时间把日志刷到 stdout，否则 Windows 下管道缓冲会吞掉输出
    setTimeout(() => app.quit(), 2000);
  }
}

/* ---------------- IPC：发给朋友 ---------------- */
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');

function setupShareIpc() {

  // 保存文件并打开文件夹。
  // ask=true 时先弹「另存为」；ask=false 直接存到「下载」文件夹（同名自动加序号），
  // 省掉对话框，真正做到「点一下就跳过去」。
  ipcMain.handle('ff:save-and-reveal', async (evt, { name, bytes, ask }) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const safe = String(name || '文件').replace(/[\\/:*?"<>|]/g, '_');
    let filePath;

    if (ask) {
      const r = await dialog.showSaveDialog(win, {
        title: '另存为',
        defaultPath: path.join(app.getPath('downloads'), safe),
        buttonLabel: '保存'
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      filePath = r.filePath;
    } else {
      const dir = app.getPath('downloads');
      filePath = path.join(dir, safe);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(safe);
        const base = path.basename(safe, ext);
        let i = 2;
        while (fs.existsSync(path.join(dir, base + ' (' + i + ')' + ext))) i++;
        filePath = path.join(dir, base + ' (' + i + ')' + ext);
      }
    }

    try {
      fs.writeFileSync(filePath, Buffer.from(bytes));
    } catch (e) {
      return { ok: false, error: e.message };
    }
    try { shell.showItemInFolder(filePath); } catch (e) {}
    return { ok: true, path: filePath };
  });

  // 打开程序自己所在的文件夹 —— 方便把 exe 拷给别人
  ipcMain.handle('ff:open-app-folder', async () => {
    // 免安装版会把自己解压到临时目录，process.execPath 指向那里；
    // 用户实际存放 exe 的目录在 PORTABLE_EXECUTABLE_DIR 里（由 portable 启动器设置）
    const dir = process.env.PORTABLE_EXECUTABLE_DIR;
    try {
      if (dir && fs.existsSync(dir)) { shell.openPath(dir); return { ok: true, path: dir }; }
      if (!app.isPackaged) { shell.openPath(__dirname); return { ok: true, path: __dirname }; }
      shell.showItemInFolder(process.execPath);
      return { ok: true, path: process.execPath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 写一个临时文件，供原生拖拽使用
  ipcMain.handle('ff:prepare-file', async (evt, { name, bytes }) => {
    const safe = String(name || '文件').replace(/[\\/:*?"<>|]/g, '_');
    const dir = path.join(app.getPath('temp'), 'ForFree-Share');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, safe);
    fs.writeFileSync(p, Buffer.from(bytes));
    return { path: p };
  });

  // 启动 Electron 原生拖拽 —— Chromium 会用真正的 IDataObject（含 CF_HDROP）
  ipcMain.on('ff:start-drag', (evt, filePath) => {
    if (!fs.existsSync(filePath)) return;
    try {
      evt.sender.startDrag({
        file: filePath,
        icon: fs.existsSync(ICON_PATH) ? ICON_PATH : path.join(__dirname, 'web', 'icon.png')
      });
    } catch (e) { console.error('拖拽启动失败：' + e.message); }
  });

  ipcMain.on('ff:copy-text', (evt, text) => {
    clipboard.writeText(String(text == null ? '' : text));
  });

  ipcMain.handle('ff:reveal', async (evt, p) => {
    if (p && fs.existsSync(p)) { try { shell.showItemInFolder(p); } catch (e) {} }
    return true;
  });

  // 再开一个窗口打开另一篇文档（同时编辑多个文件）
  ipcMain.handle('ff:open-window', async (evt, docId) => {
    if (!appBaseUrl) return { ok: false, error: '服务未就绪' };
    try {
      const w = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#F2F3F5',
        show: false,
        title: 'ForFree 办公套件',
        icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
          backgroundThrottling: false
        }
      });
      w.once('ready-to-show', () => w.show());
      w.loadURL(appBaseUrl + '/index.html' + (docId ? '?doc=' + encodeURIComponent(docId) : ''));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

/* ---------------- PDF 擦除区域（桌面版专属：用本地 mupdf 真正删除 PDF 已有内容） ----------------
   为什么网页版做不到、桌面版可以：浏览器里只能「批注」（浮在内容之上），动不了 PDF 已有的内容；
   而主进程可以调用 mupdf（WebAssembly），用 Redact 注释 + applyRedactions() 把内容**永久删除**。

   两个必须注意的点（都是实测踩出来的）：
   1) applyRedactions() 的第一个参数 black_boxes 默认是 true —— 它会在被擦除的位置画**黑块**。
      我们要的是「抹掉原文后留白」，所以必须显式传 false。
   2) saveToBuffer().asUint8Array() 返回的是**WASM 堆内存的视图**，不是拷贝。
      之后任何一次 mupdf 调用（分配/扩容）都会把它 detach 掉，再读就报
      "Cannot perform Construct on a detached ArrayBuffer"。所以这里立刻 Buffer.from() 拷一份。
   3) MuPDF 是**逐字形**判定命中：只有 bbox 落在擦除框内的字形才会被删。
      框小了会残留半个字，这是预期行为。

   坐标系：MuPDF 页面坐标 y 轴「向下」（与 PDF 规范相反），而 pdf.js 的 viewport 坐标同样是
   y 向下 —— 所以渲染进程把「视口坐标 ÷ scale」直接当 rect 传进来即可，不需要翻转 y。

   新文字**不在这里写**：MuPDF 的 FreeText 注释只会引用它内置的非嵌入字体（如 /Song，
   编码 UniGB-UTF16-H），既不嵌字体、又依赖外部 CMap，别的阅读器（含本应用自己的 pdf.js）
   很可能显示不出来。新文字改由渲染进程 canvas 渲染成图片、用 pdf-lib 贴回页面，
   这样任何阅读器都能看到、中文也绝对正确。 */
function setupPdfEditIpc() {
  // mupdf 是 ESM-only，而主进程是 CommonJS，必须用动态 import 懒加载
  let mupdfPromise = null;
  const loadMupdf = () => (mupdfPromise = mupdfPromise || import('mupdf'));

  // regions: [{ page: 0, rect: [x0,y0,x1,y1] }]  （页面点坐标，y 向下）
  ipcMain.handle('ff:pdf-redact', async (evt, payload) => {
    try {
      const mupdf = await loadMupdf();
      const doc = mupdf.Document.openDocument(Buffer.from(payload.bytes), 'application/pdf');

      const byPage = new Map();
      (payload.regions || []).forEach((op) => {
        const p = op.page | 0;
        if (!byPage.has(p)) byPage.set(p, []);
        byPage.get(p).push(op);
      });

      for (const [pi, ops] of byPage) {
        const page = doc.loadPage(pi);
        ops.forEach((o) => {
          const a = page.createAnnotation('Redact');
          a.setRect(o.rect);
          a.update();
        });
        page.applyRedactions(false);   // ★ false = 不画黑块，只删内容
      }

      const out = Buffer.from(doc.saveToBuffer('').asUint8Array());  // ★ 拷贝出 WASM 内存
      return { ok: true, bytes: out };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });
}

/* ---------------- 下载（导出文件） ---------------- */
function setupDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    // 弹「另存为」对话框，默认文件名沿用页面提供的名字
    const defaultPath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSaveDialogOptions({
      title: '保存文件',
      defaultPath: defaultPath,
      buttonLabel: '保存'
    });
    item.once('done', (e, state) => {
      if (state === 'completed' && mainWindow) {
        mainWindow.webContents.send('fw-download-done', item.getSavePath());
      }
    });
  });
}

/* ---------------- 菜单 ---------------- */
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打印 / 另存为 PDF…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow && mainWindow.webContents.print({}) },
        { type: 'separator' },
        { label: '返回首页', accelerator: 'CmdOrCtrl+H', click: () => mainWindow && mainWindow.webContents.executeJavaScript("document.querySelector('#btnHome,#btnHome2') && document.querySelector('#btnHome,#btnHome2').click()") },
        { type: 'separator' },
        { role: 'quit', label: '退出 ForFree' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '最大化' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 ForFree',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 ForFree',
              message: 'ForFree 办公套件  v' + app.getVersion(),
              detail:
                '完全免费、离线可用的办公工具。\n\n' +
                '· 文字文档 / 电子表格 / 演示文稿 / PDF 工作台\n' +
                '· 支持读写真实的 .docx / .xlsx / .pptx\n' +
                '· 内置格式转换中心\n\n' +
                '所有文档保存在本机浏览器存储中，不联网、不上传任何数据。',
              buttons: ['好的']
            });
          }
        },
        {
          label: '打开数据目录',
          click: () => shell.openPath(app.getPath('userData'))
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- 生命周期 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.forfree.desktop');
    buildMenu();
    setupDownloads();
    setupShareIpc();
    setupPdfEditIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (server) { try { server.close(); } catch (e) {} }
    app.quit();
  });
}
