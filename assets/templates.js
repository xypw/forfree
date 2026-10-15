/* ============================================================
   templates.js — 模板库
   内置模板库，全部免费。
   覆盖 文字 / 表格 / 演示 三类，共 30+ 套。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW;
  const uid = FW.uid;

  const today = () => new Date().toLocaleDateString('zh-CN');
  const now = () => new Date().toLocaleString('zh-CN');

  /* ---------------- 表格构造助手 ---------------- */
  const NUM_RE = /^-?\d+(\.\d+)?$/;

  function mkSheet(name, rowsArr, opts) {
    opts = opts || {};
    const cells = {};
    rowsArr.forEach((row, r) => row.forEach((cell, c) => {
      if (cell === null || cell === undefined || cell === '') return;
      if (typeof cell === 'object') { cells[r + ',' + c] = Object.assign({}, cell); return; }
      if (typeof cell === 'number') { cells[r + ',' + c] = { v: cell }; return; }
      const s = String(cell);
      cells[r + ',' + c] = (s.trim() !== '' && NUM_RE.test(s.trim())) ? { v: Number(s) } : { v: s };
    }));
    if (opts.header !== false) {
      const cols = Math.max.apply(null, rowsArr.map((r) => r.length));
      for (let c = 0; c < cols; c++) {
        const k = '0,' + c;
        if (cells[k]) cells[k] = Object.assign(cells[k], { b: true, bg: '#E8F5E9' });
      }
    }
    return {
      name: name, cells: cells, cols: opts.cols || {}, rows: opts.rows || {},
      colW: opts.colW || 96, rowH: opts.rowH || 26
    };
  }

  function mkDocSheet(name, rowsArr, opts) {
    const s = mkSheet(name, rowsArr, opts);
    return { sheets: [s], active: 0, rows: (opts && opts.maxRows) || 60, cols: (opts && opts.maxCols) || 16 };
  }

  /* ---------------- 演示构造助手 ---------------- */
  const THEME = { bg: '#FFFFFF', title: '#1F2328', sub: '#6B7280', accent: '#2B7FE0' };

  function T(x, y, w, h, text, size, color, opt) {
    return Object.assign({ type: 'text', x: x, y: y, w: w, h: h, text: text, size: size, color: color, align: 'left', valign: 'top' }, opt || {});
  }
  function R(x, y, w, h, fill) { return { type: 'rect', x: x, y: y, w: w, h: h, fill: fill, line: null }; }

  function slide(shapes) {
    return { layout: 'blank', bg: null, shapes: shapes.map((s) => Object.assign({ id: uid() }, s)) };
  }
  function titleSlide(title, sub) {
    return slide([
      T(90, 190, 780, 96, title, 46, THEME.title, { bold: true, align: 'center', valign: 'middle' }),
      R(400, 274, 160, 4, THEME.accent),
      T(90, 300, 780, 52, sub, 20, THEME.sub, { align: 'center', valign: 'middle' })
    ]);
  }
  function sectionSlide(title, sub) {
    return slide([
      R(0, 0, 960, 540, THEME.accent),
      T(90, 220, 780, 80, title, 46, '#FFFFFF', { bold: true, align: 'center', valign: 'middle' }),
      T(90, 308, 780, 44, sub || '', 20, 'rgba(255,255,255,.85)', { align: 'center', valign: 'middle' })
    ]);
  }
  function contentSlide(title, body, size) {
    return slide([
      T(70, 46, 820, 64, title, 32, THEME.title, { bold: true, valign: 'middle' }),
      R(70, 112, 96, 5, THEME.accent),
      T(70, 152, 820, 330, body, size || 21, THEME.sub, { align: 'left', valign: 'top', lineHeight: 1.6 })
    ]);
  }
  function twoColSlide(title, lTitle, lBody, rTitle, rBody) {
    return slide([
      T(70, 46, 820, 60, title, 32, THEME.title, { bold: true, valign: 'middle' }),
      R(70, 150, 380, 300, '#21A366'),
      R(510, 150, 380, 300, '#F2994A'),
      T(95, 172, 330, 40, lTitle, 22, '#FFFFFF', { bold: true, valign: 'middle' }),
      T(95, 222, 330, 210, lBody, 18, '#FFFFFF', { valign: 'top' }),
      T(535, 172, 330, 40, rTitle, 22, '#FFFFFF', { bold: true, valign: 'middle' }),
      T(535, 222, 330, 210, rBody, 18, '#FFFFFF', { valign: 'top' })
    ]);
  }
  function endSlide(text) {
    return slide([
      R(0, 0, 960, 540, THEME.accent),
      T(90, 220, 780, 80, text || '感谢聆听', 48, '#FFFFFF', { bold: true, align: 'center', valign: 'middle' }),
      T(90, 312, 780, 44, '欢迎批评指正', 20, 'rgba(255,255,255,.85)', { align: 'center', valign: 'middle' })
    ]);
  }
  function mkDeck(slides, theme) {
    return { size: { w: 960, h: 540 }, theme: theme || 'fresh', slides: slides };
  }

  /* ============================================================
     模板清单
     ============================================================ */
  const TEMPLATES = [

    /* ==================== 文字文档 ==================== */
    {
      key: 'report', type: 'doc', cat: '职场', name: '工作报告', desc: '标准公文排版', color: '#2B7FE0',
      build: () => ({ html:
        '<h1 style="text-align:center">工作报告</h1>' +
        '<p style="text-align:center;color:#6B7280">汇报人：___　　部门：___　　日期：' + today() + '</p><hr>' +
        '<h2>一、工作概述</h2><p>本阶段主要围绕 ___ 展开，累计完成 ___ 项任务，整体进度符合预期。</p>' +
        '<h2>二、主要成果</h2><ul><li>成果一：___</li><li>成果二：___</li><li>成果三：___</li></ul>' +
        '<h2>三、问题与不足</h2><p>___</p>' +
        '<h2>四、下一步计划</h2><ol><li>计划一：___（负责人 / 时间）</li><li>计划二：___（负责人 / 时间）</li></ol>' +
        '<p style="text-align:right;margin-top:36px">汇报人：______</p>' +
        '<p style="text-align:right">' + today() + '</p>' })
    },
    {
      key: 'resume', type: 'doc', cat: '职场', name: '个人简历', desc: '简洁单页', color: '#8B5CF6',
      build: () => ({ html:
        '<h1 style="text-align:center">姓　名</h1>' +
        '<p style="text-align:center;color:#6B7280">求职意向：产品经理　|　手机：138-0000-0000　|　邮箱：mail@example.com</p><hr>' +
        '<h2>教育背景</h2><p>2018.09 - 2022.06　某某大学　计算机科学与技术　本科</p>' +
        '<h2>工作经历</h2><p><strong>某某科技有限公司</strong>　2022.07 - 至今　产品经理</p>' +
        '<ul><li>负责 ___ 产品的需求分析与迭代规划，累计上线 ___ 个版本</li><li>主导 ___ 项目，核心指标提升 ___%</li><li>协调研发、设计、运营三方资源，推动项目按期交付</li></ul>' +
        '<h2>项目经验</h2><p><strong>___ 项目</strong>（2024.03 - 2024.09）</p><p>项目描述：___<br>我的职责：___<br>项目成果：___</p>' +
        '<h2>专业技能</h2><p>Axure / SQL / 数据分析 / 项目管理 / 英语 CET-6</p>' +
        '<h2>自我评价</h2><p>___</p>' })
    },
    {
      key: 'meeting', type: 'doc', cat: '职场', name: '会议纪要', desc: '记录与行动项', color: '#21A366',
      build: () => ({ html:
        '<h1>会议纪要</h1>' +
        '<p><strong>会议主题：</strong>___　　<strong>会议时间：</strong>' + now() + '</p>' +
        '<p><strong>会议地点：</strong>___　　<strong>主持人：</strong>___　　<strong>记录人：</strong>___</p>' +
        '<p><strong>参会人员：</strong>___</p><hr>' +
        '<h2>一、议题</h2><ol><li>___</li><li>___</li></ol>' +
        '<h2>二、讨论要点</h2><ul><li>___</li><li>___</li></ul>' +
        '<h2>三、决议事项</h2><p>___</p>' +
        '<h2>四、行动项</h2>' +
        '<table><tbody><tr><th>序号</th><th>事项</th><th>负责人</th><th>截止时间</th></tr>' +
        '<tr><td>1</td><td></td><td></td><td></td></tr><tr><td>2</td><td></td><td></td><td></td></tr><tr><td>3</td><td></td><td></td><td></td></tr></tbody></table>' })
    },
    {
      key: 'notice', type: 'doc', cat: '公文', name: '通知公告', desc: '单位内部通知', color: '#D93B2B',
      build: () => ({ html:
        '<h1 style="text-align:center">关于 ___ 的通知</h1>' +
        '<p>各部门、全体员工：</p>' +
        '<p style="text-indent:2em">经研究决定，现将 ___ 有关事项通知如下：</p>' +
        '<p style="text-indent:2em">一、___</p>' +
        '<p style="text-indent:2em">二、___</p>' +
        '<p style="text-indent:2em">三、___</p>' +
        '<p style="text-indent:2em">请各部门高度重视，认真组织落实，确保各项工作按期完成。</p>' +
        '<p style="text-indent:2em">特此通知。</p>' +
        '<p style="text-align:right;margin-top:30px">___（单位名称）</p>' +
        '<p style="text-align:right">' + today() + '</p>' })
    },
    {
      key: 'leave', type: 'doc', cat: '公文', name: '请假条', desc: '简洁规范', color: '#0EA5E9',
      build: () => ({ html:
        '<h1 style="text-align:center">请 假 条</h1>' +
        '<p>尊敬的 ___ 领导：</p>' +
        '<p style="text-indent:2em">本人 ___（部门 / 岗位），因 ___ 原因，需请假 ___ 天，请假时间为 ' + today() + ' 至 ___。请假期间工作已交接给 ___ 同志负责，联系电话 ___。</p>' +
        '<p style="text-indent:2em">恳请批准。</p>' +
        '<p style="text-align:right;margin-top:36px">申请人：______</p>' +
        '<p style="text-align:right">' + today() + '</p>' })
    },
    {
      key: 'summary', type: 'doc', cat: '职场', name: '年度工作总结', desc: '完整结构', color: '#F2994A',
      build: () => ({ html:
        '<h1 style="text-align:center">' + new Date().getFullYear() + ' 年度工作总结</h1>' +
        '<p style="text-align:center;color:#6B7280">姓名：___　　部门：___　　岗位：___</p><hr>' +
        '<h2>一、年度工作回顾</h2><p style="text-indent:2em">本年度共完成 ___ 项重点工作，具体如下：</p>' +
        '<table><tbody><tr><th>序号</th><th>工作内容</th><th>完成情况</th><th>量化成果</th></tr>' +
        '<tr><td>1</td><td></td><td></td><td></td></tr><tr><td>2</td><td></td><td></td><td></td></tr><tr><td>3</td><td></td><td></td><td></td></tr></tbody></table>' +
        '<h2>二、关键指标完成情况</h2><p>___</p>' +
        '<h2>三、存在的问题与反思</h2><ul><li>___</li><li>___</li></ul>' +
        '<h2>四、下一年度工作计划</h2><ol><li>目标一：___</li><li>目标二：___</li><li>目标三：___</li></ol>' +
        '<h2>五、个人成长</h2><p>___</p>' })
    },
    {
      key: 'plan', type: 'doc', cat: '职场', name: '项目计划书', desc: '立项用', color: '#21A366',
      build: () => ({ html:
        '<h1 style="text-align:center">项目计划书</h1>' +
        '<p style="text-align:center;color:#6B7280">项目名称：___　　编制日期：' + today() + '</p><hr>' +
        '<h2>一、项目背景</h2><p>___</p>' +
        '<h2>二、项目目标</h2><ul><li>业务目标：___</li><li>量化指标：___</li></ul>' +
        '<h2>三、范围与交付物</h2><p>___</p>' +
        '<h2>四、里程碑计划</h2>' +
        '<table><tbody><tr><th>阶段</th><th>时间</th><th>交付物</th><th>负责人</th></tr>' +
        '<tr><td>需求</td><td></td><td></td><td></td></tr><tr><td>开发</td><td></td><td></td><td></td></tr>' +
        '<tr><td>测试</td><td></td><td></td><td></td></tr><tr><td>上线</td><td></td><td></td><td></td></tr></tbody></table>' +
        '<h2>五、资源与预算</h2><p>人力：___　预算：___</p>' +
        '<h2>六、风险与应对</h2><p>___</p>' })
    },
    {
      key: 'contract', type: 'doc', cat: '公文', name: '简易合同', desc: '通用条款', color: '#5F5E5A',
      build: () => ({ html:
        '<h1 style="text-align:center">合　同　书</h1>' +
        '<p><strong>甲方（委托方）：</strong>___</p>' +
        '<p><strong>乙方（受托方）：</strong>___</p><hr>' +
        '<p>甲乙双方本着平等自愿、诚实信用的原则，经友好协商，就 ___ 事宜达成如下协议：</p>' +
        '<h2>第一条　标的与内容</h2><p>___</p>' +
        '<h2>第二条　价款与支付方式</h2><p>合同总金额为人民币 ___ 元（大写：___）。支付方式：___</p>' +
        '<h2>第三条　履行期限与地点</h2><p>履行期限：___　履行地点：___</p>' +
        '<h2>第四条　双方权利义务</h2><p>甲方：___<br>乙方：___</p>' +
        '<h2>第五条　违约责任</h2><p>___</p>' +
        '<h2>第六条　争议解决</h2><p>双方协商不成的，提交 ___ 仲裁委员会仲裁 / 向 ___ 人民法院起诉。</p>' +
        '<h2>第七条　其他</h2><p>本合同一式两份，甲乙双方各执一份，自双方签字盖章之日起生效。</p>' +
        '<table><tbody><tr><th>甲方（盖章）</th><th>乙方（盖章）</th></tr>' +
        '<tr><td style="height:70px">签字：<br>日期：</td><td>签字：<br>日期：</td></tr></tbody></table>' })
    },
    {
      key: 'thesis', type: 'doc', cat: '学术', name: '论文提纲', desc: '毕业设计用', color: '#534AB7',
      build: () => ({ html:
        '<h1 style="text-align:center">论文题目</h1>' +
        '<p style="text-align:center;color:#6B7280">作者：___　　指导教师：___　　' + today() + '</p><hr>' +
        '<h2>摘要</h2><p>本文针对 ___ 问题，采用 ___ 方法，研究了 ___，结果表明 ___。关键词：___；___；___</p>' +
        '<h2>第一章　绪论</h2><p>1.1 研究背景与意义<br>1.2 国内外研究现状<br>1.3 研究内容与方法<br>1.4 论文结构安排</p>' +
        '<h2>第二章　相关理论与技术</h2><p>2.1 ___<br>2.2 ___<br>2.3 本章小结</p>' +
        '<h2>第三章　___ 方法设计</h2><p>3.1 总体框架<br>3.2 关键模块设计<br>3.3 算法实现<br>3.4 本章小结</p>' +
        '<h2>第四章　实验与结果分析</h2><p>4.1 实验环境与数据集<br>4.2 评价指标<br>4.3 对比实验<br>4.4 结果分析</p>' +
        '<h2>第五章　总结与展望</h2><p>5.1 工作总结<br>5.2 不足与展望</p>' +
        '<h2>参考文献</h2><p>[1] 作者. 文献题名[J]. 期刊名, 年份, 卷(期): 起止页码.</p>' })
    },
    {
      key: 'thanks', type: 'doc', cat: '公文', name: '感谢信', desc: '正式书信格式', color: '#D4537E',
      build: () => ({ html:
        '<h1 style="text-align:center">感 谢 信</h1>' +
        '<p>尊敬的 ___：</p>' +
        '<p style="text-indent:2em">您好！</p>' +
        '<p style="text-indent:2em">首先，谨代表 ___ 向您致以最诚挚的感谢！在 ___ 过程中，您给予了我们大力支持与无私帮助，使得 ___ 得以顺利推进。</p>' +
        '<p style="text-indent:2em">您的 ___（具体事迹），让我们深受感动。这种精神值得我们每一个人学习。</p>' +
        '<p style="text-indent:2em">再次向您表示衷心的感谢，并祝您身体健康、工作顺利、万事如意！</p>' +
        '<p style="text-align:right;margin-top:36px">___（单位 / 个人）</p>' +
        '<p style="text-align:right">' + today() + '</p>' })
    },
    {
      key: 'activity', type: 'doc', cat: '职场', name: '活动策划案', desc: '完整方案结构', color: '#EF9F27',
      build: () => ({ html:
        '<h1 style="text-align:center">___ 活动策划方案</h1>' +
        '<p style="text-align:center;color:#6B7280">策划人：___　　日期：' + today() + '</p><hr>' +
        '<h2>一、活动背景</h2><p>___</p>' +
        '<h2>二、活动目标</h2><ul><li>目标一：___</li><li>目标二：___</li></ul>' +
        '<h2>三、活动主题</h2><p>___</p>' +
        '<h2>四、时间地点</h2><p>时间：___　地点：___　参与人数：___</p>' +
        '<h2>五、活动流程</h2>' +
        '<table><tbody><tr><th>时间</th><th>环节</th><th>内容</th><th>负责人</th></tr>' +
        '<tr><td></td><td>签到</td><td></td><td></td></tr><tr><td></td><td>开场</td><td></td><td></td></tr>' +
        '<tr><td></td><td>主体</td><td></td><td></td></tr><tr><td></td><td>收尾</td><td></td><td></td></tr></tbody></table>' +
        '<h2>六、物料与预算</h2><p>___</p>' +
        '<h2>七、宣传推广</h2><p>___</p>' +
        '<h2>八、风险预案</h2><p>___</p>' })
    },
    {
      key: 'prd', type: 'doc', cat: '职场', name: '产品需求文档', desc: 'PRD 模板', color: '#0F6E56',
      build: () => ({ html:
        '<h1 style="text-align:center">产品需求文档（PRD）</h1>' +
        '<p style="text-align:center;color:#6B7280">产品：___　　版本：v1.0　　作者：___　　' + today() + '</p><hr>' +
        '<h2>一、需求背景</h2><p>用户问题：___<br>业务诉求：___<br>不做会怎样：___</p>' +
        '<h2>二、目标与指标</h2><p>业务目标：___<br>核心指标：___（当前 ___ → 目标 ___）</p>' +
        '<h2>三、用户与场景</h2><p>目标用户：___<br>典型场景：___</p>' +
        '<h2>四、功能需求</h2>' +
        '<table><tbody><tr><th>编号</th><th>功能</th><th>描述</th><th>优先级</th></tr>' +
        '<tr><td>F1</td><td></td><td></td><td>P0</td></tr><tr><td>F2</td><td></td><td></td><td>P1</td></tr></tbody></table>' +
        '<h2>五、交互与流程</h2><p>___</p>' +
        '<h2>六、数据埋点</h2><p>___</p>' +
        '<h2>七、边界与异常</h2><p>___</p>' +
        '<h2>八、上线计划</h2><p>___</p>' })
    },
    {
      key: 'reading', type: 'doc', cat: '学术', name: '读书笔记', desc: '阅读记录', color: '#BA7517',
      build: () => ({ html:
        '<h1>《书名》读书笔记</h1>' +
        '<p><strong>作者：</strong>___　　<strong>阅读时间：</strong>' + today() + '　　<strong>评分：</strong>★★★★☆</p><hr>' +
        '<h2>一句话总结</h2><p>___</p>' +
        '<h2>核心观点</h2><ol><li>___</li><li>___</li><li>___</li></ol>' +
        '<h2>精彩摘录</h2>' +
        '<blockquote>「___」　—— 第 ___ 页</blockquote>' +
        '<blockquote>「___」　—— 第 ___ 页</blockquote>' +
        '<h2>我的思考</h2><p>___</p>' +
        '<h2>可以怎么用</h2><ul><li>___</li><li>___</li></ul>' })
    },

    /* ==================== 电子表格 ==================== */
    {
      key: 'budget', type: 'sheet', cat: '财务', name: '费用预算表', desc: '自动求和', color: '#21A366',
      build: () => mkDocSheet('预算表', [
        ['项目', '预算金额', '实际支出', '差额', '执行率'],
        ['人力成本', 50000, 46000, { f: '=B2-C2', fmt: 'currency' }, { f: '=IF(B2=0,0,C2/B2)', fmt: 'percent' }],
        ['差旅费', 12000, 13500, { f: '=B3-C3', fmt: 'currency' }, { f: '=IF(B3=0,0,C3/B3)', fmt: 'percent' }],
        ['办公用品', 6000, 4800, { f: '=B4-C4', fmt: 'currency' }, { f: '=IF(B4=0,0,C4/B4)', fmt: 'percent' }],
        ['市场推广', 30000, 28500, { f: '=B5-C5', fmt: 'currency' }, { f: '=IF(B5=0,0,C5/B5)', fmt: 'percent' }],
        ['其他', 8000, 6200, { f: '=B6-C6', fmt: 'currency' }, { f: '=IF(B6=0,0,C6/B6)', fmt: 'percent' }],
        [{ v: '合计', b: true }, { f: '=SUM(B2:B6)', fmt: 'currency', b: true }, { f: '=SUM(C2:C6)', fmt: 'currency', b: true },
          { f: '=SUM(D2:D6)', fmt: 'currency', b: true }, { f: '=IF(B7=0,0,C7/B7)', fmt: 'percent', b: true }]
      ], { cols: { 0: 130, 1: 110, 2: 110, 3: 110, 4: 90 }, maxRows: 40, maxCols: 10 })
    },
    {
      key: 'todo', type: 'sheet', cat: '效率', name: '任务清单', desc: '进度跟踪', color: '#0EA5E9',
      build: () => mkDocSheet('任务清单', [
        ['序号', '任务', '负责人', '优先级', '截止日期', '状态', '进度'],
        [1, '需求评审', '张三', { v: '高', color: '#D93B2B' }, '2026-10-20', '进行中', { v: 0.6, fmt: 'percent' }],
        [2, '接口联调', '李四', { v: '中', color: '#F2994A' }, '2026-10-25', '未开始', { v: 0, fmt: 'percent' }],
        [3, '测试验收', '王五', { v: '低', color: '#21A366' }, '2026-10-30', '未开始', { v: 0, fmt: 'percent' }],
        [4, '上线发布', '张三', { v: '高', color: '#D93B2B' }, '2026-11-05', '未开始', { v: 0, fmt: 'percent' }]
      ], { cols: { 0: 56, 1: 220, 2: 90, 3: 80, 4: 110, 5: 90, 6: 80 }, maxRows: 40, maxCols: 10 })
    },
    {
      key: 'cashbook', type: 'sheet', cat: '财务', name: '收支记账', desc: '自动结余', color: '#21A366',
      build: () => {
        const rows = [['日期', '类型', '分类', '说明', '收入', '支出', '结余']];
        const data = [
          ['2026-10-01', '收入', '工资', '10 月工资', 12000, ''],
          ['2026-10-03', '支出', '餐饮', '朋友聚餐', '', 320],
          ['2026-10-05', '支出', '交通', '地铁充值', '', 100],
          ['2026-10-08', '支出', '购物', '生活用品', '', 480],
          ['2026-10-10', '收入', '兼职', '外包项目', 3000, '']
        ];
        data.forEach((r, i) => rows.push(r));
        const sheet = mkSheet('收支明细', rows, { cols: { 0: 100, 1: 70, 2: 80, 3: 180, 4: 90, 5: 90, 6: 100 } });
        const n = rows.length;
        for (let r = 2; r <= n; r++) {
          const prev = r === 2 ? '0' : 'G' + (r - 1);
          sheet.cells[(r - 1) + ',6'] = { f: '=' + prev + '+E' + r + '-F' + r, fmt: 'currency' };
        }
        sheet.cells[n + ',4'] = { f: '=SUM(E2:E' + n + ')', fmt: 'currency', b: true, bg: '#E8F5E9' };
        sheet.cells[n + ',5'] = { f: '=SUM(F2:F' + n + ')', fmt: 'currency', b: true, bg: '#E8F5E9' };
        sheet.cells[n + ',6'] = { f: '=E' + (n + 1) + '-F' + (n + 1), fmt: 'currency', b: true, bg: '#E8F5E9' };
        sheet.cells[n + ',3'] = { v: '合计', b: true, align: 'right', bg: '#E8F5E9' };
        return { sheets: [sheet], active: 0, rows: 60, cols: 12 };
      }
    },
    {
      key: 'schedule', type: 'sheet', cat: '人事', name: '排班表', desc: '月度排班', color: '#F2994A',
      build: () => mkDocSheet('排班表', [
        ['姓名', '1日', '2日', '3日', '4日', '5日', '6日', '7日', '合计班次'],
        ['张三', '早班', '早班', '休', '晚班', '晚班', '休', '早班', { f: '=COUNTIF(B2:H2,"*班")', b: true }],
        ['李四', '晚班', '休', '早班', '早班', '休', '晚班', '晚班', { f: '=COUNTIF(B3:H3,"*班")', b: true }],
        ['王五', '休', '晚班', '晚班', '休', '早班', '早班', '休', { f: '=COUNTIF(B4:H4,"*班")', b: true }]
      ], { cols: { 0: 80, 8: 90 }, colW: 64, maxRows: 40, maxCols: 12 })
    },
    {
      key: 'score', type: 'sheet', cat: '教育', name: '学生成绩表', desc: '自动排名', color: '#534AB7',
      build: () => mkDocSheet('成绩表', [
        ['学号', '姓名', '语文', '数学', '英语', '总分', '平均分', '排名'],
        ['2026001', '张小明', 92, 88, 95, { f: '=SUM(C2:E2)' }, { f: '=ROUND(AVERAGE(C2:E2),1)' }, { f: '=RANK(F2,$F$2:$F$6)' }],
        ['2026002', '李小红', 85, 96, 78, { f: '=SUM(C3:E3)' }, { f: '=ROUND(AVERAGE(C3:E3),1)' }, { f: '=RANK(F3,$F$2:$F$6)' }],
        ['2026003', '王小明', 78, 72, 88, { f: '=SUM(C4:E4)' }, { f: '=ROUND(AVERAGE(C4:E4),1)' }, { f: '=RANK(F4,$F$2:$F$6)' }],
        ['2026004', '赵小红', 95, 91, 92, { f: '=SUM(C5:E5)' }, { f: '=ROUND(AVERAGE(C5:E5),1)' }, { f: '=RANK(F5,$F$2:$F$6)' }],
        ['2026005', '刘小明', 88, 84, 79, { f: '=SUM(C6:E6)' }, { f: '=ROUND(AVERAGE(C6:E6),1)' }, { f: '=RANK(F6,$F$2:$F$6)' }],
        [{ v: '班级平均', b: true, bg: '#E8F5E9' }, { v: '', bg: '#E8F5E9' },
          { f: '=ROUND(AVERAGE(C2:C6),1)', b: true, bg: '#E8F5E9' }, { f: '=ROUND(AVERAGE(D2:D6),1)', b: true, bg: '#E8F5E9' },
          { f: '=ROUND(AVERAGE(E2:E6),1)', b: true, bg: '#E8F5E9' }, { f: '=ROUND(AVERAGE(F2:F6),1)', b: true, bg: '#E8F5E9' },
          { f: '=ROUND(AVERAGE(G2:G6),1)', b: true, bg: '#E8F5E9' }, { v: '', bg: '#E8F5E9' }]
      ], { cols: { 0: 90, 1: 90, 7: 70 }, maxRows: 40, maxCols: 10 })
    },
    {
      key: 'quote', type: 'sheet', cat: '商务', name: '报价单', desc: '含税总价', color: '#0F6E56',
      build: () => {
        const rows = [
          ['报价单'],
          ['客户名称', '', '报价日期', today()],
          ['序号', '产品 / 服务', '规格', '数量', '单价', '金额'],
          [1, '产品 A', '标准版', 10, 1200, { f: '=D4*E4', fmt: 'currency' }],
          [2, '产品 B', '专业版', 5, 2600, { f: '=D5*E5', fmt: 'currency' }],
          [3, '实施服务', '人天', 8, 1500, { f: '=D6*E6', fmt: 'currency' }],
          [{ v: '合计（不含税）', b: true }, '', '', '', '', { f: '=SUM(F4:F6)', fmt: 'currency', b: true }],
          [{ v: '税率', b: true }, '', '', '', '', { v: 0.06, fmt: 'percent', b: true }],
          [{ v: '税额', b: true }, '', '', '', '', { f: '=ROUND(F7*F8,2)', fmt: 'currency', b: true }],
          [{ v: '总计（含税）', b: true, bg: '#E8F5E9' }, '', '', '', '', { f: '=F7+F9', fmt: 'currency', b: true, bg: '#E8F5E9' }]
        ];
        const sheet = mkSheet('报价单', rows, { header: false, cols: { 0: 110, 1: 160, 2: 100, 3: 70, 4: 90, 5: 110 } });
        sheet.cells['0,0'] = { v: '报价单', b: true, size: 18, bg: null, align: 'center' };
        for (let c = 0; c < 6; c++) { sheet.cells['2,' + c] = Object.assign(sheet.cells['2,' + c] || { v: '' }, { b: true, bg: '#E8F5E9' }); }
        return { sheets: [sheet], active: 0, rows: 40, cols: 10 };
      }
    },
    {
      key: 'stock', type: 'sheet', cat: '商务', name: '库存管理', desc: '出入库与预警', color: '#BA7517',
      build: () => mkDocSheet('库存表', [
        ['商品编码', '商品名称', '规格', '入库', '出库', '当前库存', '安全库存', '状态'],
        ['SP001', '商品 A', '500ml', 200, 150, { f: '=D2-E2' }, 50, { f: '=IF(F2<G2,"需补货","正常")' }],
        ['SP002', '商品 B', '1L', 120, 30, { f: '=D3-E3' }, 40, { f: '=IF(F3<G3,"需补货","正常")' }],
        ['SP003', '商品 C', '250ml', 300, 280, { f: '=D4-E4' }, 60, { f: '=IF(F4<G4,"需补货","正常")' }],
        ['SP004', '商品 D', '2L', 80, 20, { f: '=D5-E5' }, 30, { f: '=IF(F5<G5,"需补货","正常")' }],
        [{ v: '合计', b: true }, '', '', { f: '=SUM(D2:D5)', b: true }, { f: '=SUM(E2:E5)', b: true }, { f: '=SUM(F2:F5)', b: true }, '', '']
      ], { cols: { 0: 100, 1: 140, 2: 80, 7: 90 }, maxRows: 40, maxCols: 10 })
    },
    {
      key: 'gantt', type: 'sheet', cat: '效率', name: '项目进度（甘特）', desc: '周维度跟踪', color: '#2B7FE0',
      build: () => {
        const weeks = ['第1周', '第2周', '第3周', '第4周', '第5周', '第6周', '第7周', '第8周'];
        const head = ['任务', '负责人', '开始', '结束', '工期(天)'].concat(weeks);
        const rows = [head];
        const data = [
          ['需求分析', '张三', '10-01', '10-07', 7, '■■■', '', '', '', '', '', '', ''],
          ['方案设计', '李四', '10-05', '10-15', 11, '', '■■■', '', '', '', '', '', ''],
          ['开发实现', '王五', '10-12', '11-05', 25, '', '', '■■■■', '■', '', '', '', ''],
          ['测试验证', '张三', '11-01', '11-15', 15, '', '', '', '', '■■■', '', '', ''],
          ['上线发布', '李四', '11-16', '11-18', 3, '', '', '', '', '', '■', '', ''],
          ['验收总结', '王五', '11-19', '11-25', 7, '', '', '', '', '', '', '■■', '']
        ];
        data.forEach((r) => rows.push(r));
        return { sheets: [mkSheet('甘特图', rows, { cols: { 0: 120, 1: 80, 2: 80, 3: 80, 4: 80 }, colW: 68 })], active: 0, rows: 40, cols: 16 };
      }
    },
    {
      key: 'crm', type: 'sheet', cat: '商务', name: '客户跟进表', desc: '销售管理', color: '#D4537E',
      build: () => mkDocSheet('客户跟进', [
        ['客户名称', '联系人', '电话', '意向等级', '预计金额', '跟进阶段', '下次跟进', '负责人'],
        ['某某科技', '张总', '138-0000-0001', { v: 'A', color: '#D93B2B', b: true }, { v: 200000, fmt: 'currency' }, '商务谈判', '2026-10-20', '李四'],
        ['某某集团', '王经理', '138-0000-0002', { v: 'B', color: '#F2994A', b: true }, { v: 80000, fmt: 'currency' }, '需求确认', '2026-10-22', '张三'],
        ['某某实业', '刘主任', '138-0000-0003', { v: 'C', color: '#21A366', b: true }, { v: 30000, fmt: 'currency' }, '初步接触', '2026-10-28', '王五']
      ], { cols: { 0: 130, 1: 80, 2: 130, 3: 80, 4: 110, 5: 100, 6: 110, 7: 80 }, maxRows: 50, maxCols: 12 })
    },
    {
      key: 'kpi', type: 'sheet', cat: '效率', name: '数据看板', desc: 'KPI 汇总', color: '#0EA5E9',
      build: () => mkDocSheet('数据看板', [
        ['指标', '本月', '上月', '环比', '目标', '达成率', '状态'],
        ['新增用户', 12800, 10400, { f: '=IF(B2=0,0,B2/C2-1)', fmt: 'percent' }, 15000, { f: '=B2/E2', fmt: 'percent' }, { f: '=IF(F2>=1,"达标","未达标")' }],
        ['活跃用户', 8600, 7900, { f: '=IF(B3=0,0,B3/C3-1)', fmt: 'percent' }, 9000, { f: '=B3/E3', fmt: 'percent' }, { f: '=IF(F3>=1,"达标","未达标")' }],
        ['付费转化', 0.042, 0.038, { f: '=IF(B4=0,0,B4/C4-1)', fmt: 'percent' }, 0.05, { f: '=B4/E4', fmt: 'percent' }, { f: '=IF(F4>=1,"达标","未达标")' }],
        ['营收(元)', 486000, 412000, { f: '=IF(B5=0,0,B5/C5-1)', fmt: 'percent' }, 500000, { f: '=B5/E5', fmt: 'percent' }, { f: '=IF(F5>=1,"达标","未达标")' }],
        ['客单价', 386, 352, { f: '=IF(B6=0,0,B6/C6-1)', fmt: 'percent' }, 400, { f: '=B6/E6', fmt: 'percent' }, { f: '=IF(F6>=1,"达标","未达标")' }]
      ], { cols: { 0: 110, 1: 100, 2: 100, 3: 80, 4: 100, 5: 90, 6: 90 }, maxRows: 40, maxCols: 10 })
    },

    /* ==================== 演示文稿 ==================== */
    {
      key: 'deck-report', type: 'slide', cat: '汇报', name: '工作汇报', desc: '6 页标准结构', color: '#2B7FE0',
      build: () => mkDeck([
        titleSlide(new Date().getFullYear() + ' 年度工作汇报', '汇报人：___　　' + today()),
        contentSlide('01　工作概述', '· 本阶段整体进展\n· 核心指标完成情况\n· 团队协作与资源投入'),
        twoColSlide('02　成果与不足', '主要成果', '1. 完成核心功能上线\n2. 用户满意度提升\n3. 交付周期缩短', '待改进', '1. 需求变更较频繁\n2. 测试覆盖待加强\n3. 文档沉淀不足'),
        contentSlide('03　数据表现', '· 核心指标 A：___（同比 +___%）\n· 核心指标 B：___（同比 +___%）\n· 核心指标 C：___（同比 +___%）'),
        contentSlide('04　下一步计划', '· 目标一：____（负责人 / 时间）\n· 目标二：____（负责人 / 时间）\n· 目标三：____（负责人 / 时间）'),
        endSlide('感谢聆听')
      ], 'fresh')
    },
    {
      key: 'deck-product', type: 'slide', cat: '商务', name: '产品介绍', desc: '6 页产品宣讲', color: '#21A366',
      build: () => mkDeck([
        titleSlide('产品名称', '一句话说清产品价值'),
        contentSlide('01　用户痛点', '· 痛点一：___\n· 痛点二：___\n· 痛点三：___'),
        contentSlide('02　我们的方案', '· 核心能力一：___\n· 核心能力二：___\n· 核心能力三：___'),
        twoColSlide('03　核心优势', '对比传统方案', '· 更快：___\n· 更省：___\n· 更稳：___', '对比同类产品', '· 差异化一：___\n· 差异化二：___\n· 差异化三：___'),
        contentSlide('04　客户案例', '· 客户 A：使用后 ___ 提升 ___%\n· 客户 B：使用后 ___ 降低 ___%\n· 客户 C：___'),
        endSlide('期待与您合作')
      ], 'green')
    },
    {
      key: 'deck-teach', type: 'slide', cat: '教育', name: '教学课件', desc: '课程讲授用', color: '#534AB7',
      build: () => mkDeck([
        titleSlide('课程名称', '授课教师：___　　课时：___'),
        contentSlide('学习目标', '1. 掌握 ___ 的基本概念\n2. 理解 ___ 的原理\n3. 能够独立完成 ___'),
        contentSlide('知识回顾', '· 上一节课我们学习了 ___\n· 关键结论是 ___\n· 今天在此基础上继续深入'),
        contentSlide('新课讲解', '· 概念定义：___\n· 核心要点：___\n· 典型示例：___'),
        twoColSlide('对比辨析', '容易混淆的概念 A', '特点：___\n适用场景：___', '容易混淆的概念 B', '特点：___\n适用场景：___'),
        contentSlide('课堂练习', '练习一：___\n\n练习二：___\n\n思考题：___'),
        contentSlide('本节小结', '· 本节课我们学习了 ___\n· 重点是 ___\n· 难点是 ___'),
        endSlide('下课')
      ], 'fresh')
    },
    {
      key: 'deck-annual', type: 'slide', cat: '汇报', name: '年终总结', desc: '8 页完整版', color: '#F2994A',
      build: () => mkDeck([
        titleSlide(new Date().getFullYear() + ' 年终总结', '姓名：___　　部门：___'),
        sectionSlide('01', '年度回顾'),
        contentSlide('关键成果', '· 成果一：___（量化：___）\n· 成果二：___（量化：___）\n· 成果三：___（量化：___）'),
        contentSlide('数据对比', '· 指标 A：去年 ___ → 今年 ___（+___%）\n· 指标 B：去年 ___ → 今年 ___（+___%）\n· 指标 C：去年 ___ → 今年 ___（+___%）'),
        sectionSlide('02', '反思与成长'),
        twoColSlide('做得好 vs 待改进', '做得好的', '1. ___\n2. ___\n3. ___', '待改进的', '1. ___\n2. ___\n3. ___'),
        contentSlide('明年计划', '· Q1：___\n· Q2：___\n· Q3：___\n· Q4：___'),
        endSlide('谢谢大家')
      ], 'warm')
    },
    {
      key: 'deck-proposal', type: 'slide', cat: '商务', name: '项目提案', desc: '立项评审用', color: '#0F6E56',
      build: () => mkDeck([
        titleSlide('项目名称', '提案人：___　　' + today()),
        contentSlide('项目背景', '· 业务现状：___\n· 存在问题：___\n· 不做的代价：___'),
        contentSlide('项目目标', '· 业务目标：___\n· 量化指标：___ → ___\n· 时间节点：___'),
        contentSlide('实施方案', '· 阶段一：___（时间）\n· 阶段二：___（时间）\n· 阶段三：___（时间）'),
        twoColSlide('资源与预算', '所需资源', '· 人力：___\n· 预算：___\n· 其他：___', '预期收益', '· 直接收益：___\n· 间接收益：___\n· 回收周期：___'),
        contentSlide('风险与应对', '· 风险一：___ → 应对：___\n· 风险二：___ → 应对：___'),
        endSlide('恳请批准')
      ], 'green')
    },
    {
      key: 'deck-compete', type: 'slide', cat: '商务', name: '竞品分析', desc: '市场调研用', color: '#D93B2B',
      build: () => mkDeck([
        titleSlide('竞品分析报告', '分析人：___　　' + today()),
        contentSlide('分析范围', '· 直接竞品：___\n· 间接竞品：___\n· 潜在竞品：___'),
        contentSlide('竞品概览', '· 竞品 A：定位 ___，核心优势 ___\n· 竞品 B：定位 ___，核心优势 ___\n· 竞品 C：定位 ___，核心优势 ___'),
        twoColSlide('优劣势对比', '我们的优势', '1. ___\n2. ___\n3. ___', '我们的劣势', '1. ___\n2. ___\n3. ___'),
        contentSlide('差异化机会', '· 机会一：___\n· 机会二：___\n· 机会三：___'),
        endSlide('讨论')
      ], 'fresh')
    },
    {
      key: 'deck-data', type: 'slide', cat: '汇报', name: '数据分析报告', desc: '数据汇报用', color: '#0EA5E9',
      build: () => mkDeck([
        titleSlide('数据分析报告', '分析周期：___　　分析人：___'),
        contentSlide('分析背景与目标', '· 背景：___\n· 待验证的问题：___\n· 期望产出：___'),
        contentSlide('核心结论（先讲结论）', '1. ___\n2. ___\n3. ___'),
        contentSlide('数据支撑', '· 指标 A：___，环比 ___\n· 指标 B：___，环比 ___\n· 指标 C：___，环比 ___'),
        contentSlide('原因分析', '· 因素一：___（贡献度 ___%）\n· 因素二：___（贡献度 ___%）'),
        contentSlide('行动建议', '· 建议一：___（负责人 / 时间）\n· 建议二：___（负责人 / 时间）'),
        endSlide('Q & A')
      ], 'fresh')
    },
    {
      key: 'deck-team', type: 'slide', cat: '汇报', name: '团队介绍', desc: '部门 / 团队展示', color: '#8B5CF6',
      build: () => mkDeck([
        titleSlide('团队介绍', '团队名称：___'),
        contentSlide('团队定位', '· 我们负责：___\n· 我们服务的对象：___\n· 我们的核心价值：___'),
        contentSlide('组织架构', '· 团队负责人：___\n· 小组一：___（___ 人）\n· 小组二：___（___ 人）'),
        twoColSlide('协作方式', '日常机制', '· 周会：___\n· 日报：___\n· 复盘：___', '工具与规范', '· 协作工具：___\n· 代码规范：___\n· 文档沉淀：___'),
        contentSlide('团队成果', '· 成果一：___\n· 成果二：___\n· 成果三：___'),
        endSlide('欢迎加入')
      ], 'fresh')
    },
    {
      key: 'deck-training', type: 'slide', cat: '教育', name: '培训课件', desc: '内部培训用', color: '#F2994A',
      build: () => mkDeck([
        titleSlide('培训主题', '讲师：___　　时长：___'),
        contentSlide('为什么学这个', '· 工作中遇到的真实问题：___\n· 学会后能解决什么：___'),
        contentSlide('核心知识点', '1. ___\n2. ___\n3. ___'),
        contentSlide('实操演示', '· 步骤一：___\n· 步骤二：___\n· 步骤三：___'),
        twoColSlide('常见错误', '容易犯的错', '1. ___\n2. ___\n3. ___', '正确做法', '1. ___\n2. ___\n3. ___'),
        contentSlide('课后作业', '· 作业一：___\n· 作业二：___'),
        endSlide('谢谢参与')
      ], 'warm')
    },
    {
      key: 'deck-bp', type: 'slide', cat: '商务', name: '商业计划书', desc: '路演用精简版', color: '#D4537E',
      build: () => mkDeck([
        titleSlide('项目名称', '一句话定位：___'),
        contentSlide('市场机会', '· 市场规模：___\n· 增长趋势：___\n· 未被满足的需求：___'),
        contentSlide('产品与模式', '· 我们做什么：___\n· 怎么赚钱：___\n· 单位经济模型：___'),
        twoColSlide('竞争壁垒', '我们的优势', '1. ___\n2. ___\n3. ___', '壁垒来源', '1. 技术：___\n2. 数据：___\n3. 网络效应：___'),
        contentSlide('团队', '· 创始人：___（背景）\n· 核心成员：___\n· 顾问：___'),
        contentSlide('融资计划', '· 本轮融资：___ 万元\n· 出让股权：___%\n· 资金用途：___'),
        endSlide('联系我们')
      ], 'fresh')
    }
  ];

  /* ============================================================
     对外接口
     ============================================================ */
  const CATS = {
    doc: ['全部', '职场', '公文', '学术'],
    sheet: ['全部', '财务', '效率', '人事', '教育', '商务'],
    slide: ['全部', '汇报', '商务', '教育']
  };

  function byType(type) { return TEMPLATES.filter((t) => t.type === type); }

  function find(key) { return TEMPLATES.find((t) => t.key === key); }

  /** 从模板新建文档并打开 */
  function use(key) {
    const t = find(key);
    if (!t) return null;
    const d = FW.createDoc(t.type);
    d.title = t.name;
    d.data = t.build();
    if (t.type === 'slide' && !d.data.size) d.data.size = { w: 960, h: 540 };
    FW.Store.upsert(d);
    if (FW.app) FW.app.openDoc(d);
    FW.toast('已从模板创建：' + t.name);
    return d;
  }

  global.TEMPLATES = { all: TEMPLATES, byType: byType, find: find, use: use, CATS: CATS };
})(window);
