/* ============================================================
   history.js — 历史版本 + 回收站
   历史版本与回收站。
   全部在本机 localStorage 完成，不联网。
   ============================================================ */
(function (global) {
  'use strict';
  const FW = global.FW, $ = FW.$, $$ = FW.$$;
  const Store = FW.Store;

  /* ============================================================
     一、自动快照
     ============================================================ */
  function autoSnapshot(doc) {
    if (!doc || !doc.id) return;
    const ts = Store.snapshot(doc, '', { force: false });
    if (ts && FW.app && FW.app.current() && FW.app.current() !== 'pdf') {
      updateVersionBadge();
    }
    return ts;
  }

  function manualSnapshot(doc) {
    if (!doc) return null;
    const note = prompt('给这个版本加个备注（可留空）：', '');
    if (note === null) return null;
    const ts = Store.snapshot(doc, note, { force: true });
    if (ts) FW.toast('已保存版本 · ' + FW.fmtTime(ts));
    else FW.toast('保存版本失败：内容过大或本地空间不足');
    return ts;
  }

  /* ============================================================
     二、历史版本面板
     ============================================================ */
  let modal = null;
  let curDocId = null;
  let previewTs = null;

  function buildModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-mask';
    modal.id = 'historyMask';
    modal.innerHTML =
      '<div class="modal modal-wide">' +
      '<div class="modal-head">' +
      '<h3>历史版本</h3>' +
      '<div class="hv-head-actions">' +
      '<button class="ghost-btn" id="hvSnap">存为版本</button>' +
      '<button class="ghost-btn" id="hvClear">清空历史</button>' +
      '<button class="modal-x" data-hv-close>×</button>' +
      '</div></div>' +
      '<div class="modal-body hv-body">' +
      '<p class="hv-tip">系统会在编辑过程中自动留存版本（最多 12 个）。' +
      '点「还原」会把文档内容回退到该版本，还原前会自动备份当前内容。</p>' +
      '<div id="hvList" class="hv-list"></div>' +
      '<div id="hvPreview" class="hv-preview"></div>' +
      '</div></div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-hv-close]')) close();
    });
    $('#hvSnap', modal).addEventListener('click', () => {
      const doc = currentDoc();
      if (!doc) return;
      const ts = manualSnapshot(doc);
      if (ts) renderList();
    });
    $('#hvClear', modal).addEventListener('click', () => {
      if (!curDocId) return;
      if (!confirm('确定清空该文档的全部历史版本？此操作不可恢复。')) return;
      Store.clearVersions(curDocId);
      previewTs = null;
      renderList();
      FW.toast('已清空历史版本');
    });
    $('#hvList', modal).addEventListener('click', onListClick);
    return modal;
  }

  function currentDoc() {
    if (FW.app && FW.app.currentDoc) return FW.app.currentDoc();
    return null;
  }

  function onListClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.hv-item');
    if (!row) return;
    const ts = +row.dataset.ts;
    const act = btn.dataset.act;

    if (act === 'preview') {
      previewTs = (previewTs === ts) ? null : ts;
      renderList();
      return;
    }
    if (act === 'compare') {
      close();
      if (global.DIFF) global.DIFF.compareVersions(curDocId, ts);
      return;
    }
    if (act === 'restore') {
      if (!confirm('确定把文档还原到 ' + FW.fmtTime(ts) + ' 的版本？\n当前内容会先自动备份为一个新版本。')) return;
      const doc = Store.restoreVersion(curDocId, ts);
      if (!doc) { FW.toast('还原失败'); return; }
      close();
      if (FW.app) FW.app.openDoc(doc);
      FW.toast('已还原到 ' + FW.fmtTime(ts));
      return;
    }
    if (act === 'delete') {
      Store.deleteVersion(curDocId, ts);
      if (previewTs === ts) previewTs = null;
      renderList();
      return;
    }
  }

  function versionPreviewHtml(v) {
    let text = '';
    try {
      const data = JSON.parse(v.data);
      text = (global.DIFF ? global.DIFF.docToPlain({ type: v.type, data: data }) : '');
    } catch (e) { text = ''; }
    if (!text) text = '（空文档）';
    const cut = text.length > 1200 ? text.slice(0, 1200) + '\n\n…（仅显示前 1200 字）' : text;
    return '<pre>' + FW.escapeHtml(cut) + '</pre>';
  }

  function renderList() {
    const box = $('#hvList', modal);
    const list = Store.versions(curDocId);
    if (!list.length) {
      box.innerHTML = '<div class="hv-empty">还没有历史版本。<br>' +
        '编辑过程中系统会自动留存，也可以点右上角「存为版本」手动存一个。</div>';
      $('#hvPreview', modal).innerHTML = '';
      return;
    }
    box.innerHTML = list.map((v, i) => {
      const meta = FW.TYPE_META[v.type] || { name: '文档' };
      return '<div class="hv-item' + (previewTs === v.ts ? ' open' : '') + '" data-ts="' + v.ts + '">' +
        '<div class="hv-row">' +
        '<span class="hv-idx">' + (i === 0 ? '最新' : 'v' + (list.length - i)) + '</span>' +
        '<div class="hv-info"><strong>' + FW.fmtTime(v.ts) + '</strong>' +
        '<span>' + meta.name + ' · ' + FW.fmtSize(v.size) + (v.note ? ' · ' + FW.escapeHtml(v.note) : '') + '</span></div>' +
        '<div class="hv-acts">' +
        '<button class="mini-btn" data-act="preview">' + (previewTs === v.ts ? '收起' : '预览') + '</button>' +
        '<button class="mini-btn" data-act="compare">对比</button>' +
        '<button class="mini-btn" data-act="restore">还原</button>' +
        '<button class="mini-btn danger" data-act="delete">删除</button>' +
        '</div></div>' +
        (previewTs === v.ts ? '<div class="hv-body-inline">' + versionPreviewHtml(v) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  function updateVersionBadge() {
    // 编辑器标题栏的「版本」按钮加个数量角标
    const btn = document.querySelector('[data-qa="history"]');
    if (!btn) return;
    const doc = currentDoc();
    let n = 0;
    if (doc) n = Store.versionCount(doc.id);
    let badge = btn.querySelector('.qa-badge');
    if (!n) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('i');
      badge.className = 'qa-badge';
      btn.appendChild(badge);
    }
    badge.textContent = n;
  }

  function openPanel(docId) {
    const doc = docId ? Store.get(docId) : currentDoc();
    if (!doc) { FW.toast('请先打开一个文档'); return; }
    curDocId = doc.id;
    previewTs = null;
    buildModal();
    renderList();
    modal.classList.add('on');
  }

  function close() {
    if (modal) modal.classList.remove('on');
  }

  /* ============================================================
     三、回收站
     ============================================================ */
  function renderTrash() {
    const box = $('#trashList');
    if (!box) return;
    const list = Store.trashList();
    if (!list.length) {
      box.innerHTML = '<div class="empty">回收站是空的</div>';
      return;
    }
    box.innerHTML = list.map((d) => {
      const m = FW.TYPE_META[d.type] || { name: '文档', icon: '?', color: '#8D949E' };
      const verN = Store.versionCount(d.id);
      return '<div class="recent-item" data-id="' + d.id + '">' +
        '<div class="ri-icon" style="background:' + m.color + '">' + m.icon + '</div>' +
        '<div class="ri-main"><strong>' + FW.escapeHtml(d.title || '未命名') + '</strong>' +
        '<span>' + m.name + ' · 删除于 ' + FW.fmtTime(d.deletedAt || d.updated) +
        (verN ? ' · 含 ' + verN + ' 个历史版本' : '') + '</span></div>' +
        '<div class="ri-actions" style="opacity:1">' +
        '<button class="mini-btn" data-act="restore">还原</button>' +
        '<button class="mini-btn danger" data-act="purge">彻底删除</button>' +
        '</div></div>';
    }).join('');
  }

  function updateTrashBadge() {
    const n = Store.trashList().length;
    const b = $('#trashBadge');
    if (!b) return;
    b.textContent = n;
    b.style.display = n ? 'inline-block' : 'none';
  }

  let trashBound = false;

  function bindTrash() {
    if (trashBound) return;
    trashBound = true;

    $('#trashList').addEventListener('click', (e) => {
      const item = e.target.closest('.recent-item');
      const btn = e.target.closest('button');
      if (!item || !btn) return;
      const id = item.dataset.id;
      const act = btn.dataset.act;
      if (act === 'restore') {
        const d = Store.restore(id);
        if (d) { FW.toast('已还原：' + d.title); renderTrash(); updateTrashBadge(); if (FW.app) FW.app.refreshHome(); }
      } else if (act === 'purge') {
        const d = Store.trashList().find((x) => x.id === id);
        if (!confirm('彻底删除「' + (d ? d.title : '') + '」？此操作不可恢复，历史版本也会一并清除。')) return;
        Store.clearVersions(id);
        Store.purge(id);
        renderTrash(); updateTrashBadge();
        FW.toast('已彻底删除');
      }
    });

    $('#trashEmpty').addEventListener('click', () => {
      const n = Store.trashList().length;
      if (!n) { FW.toast('回收站已经是空的'); return; }
      if (!confirm('确定清空回收站？共 ' + n + ' 个文档，清空后无法恢复。')) return;
      Store.trashList().forEach((d) => Store.clearVersions(d.id));
      Store.emptyTrash();
      renderTrash(); updateTrashBadge();
      FW.toast('回收站已清空');
    });
  }

  function openTrash() {
    bindTrash();
    renderTrash();
    if (FW.app) FW.app.showView('trash');
  }

  global.HISTORY = {
    autoSnapshot: autoSnapshot,
    manualSnapshot: manualSnapshot,
    openPanel: openPanel,
    updateVersionBadge: updateVersionBadge
  };
  global.TRASH = {
    open: openTrash,
    render: renderTrash,
    updateBadge: updateTrashBadge
  };
})(window);
