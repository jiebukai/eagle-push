// ==UserScript==
// @name         浪潮云 CSS 工单自动转派
// @namespace    https://css.cloud.inspur.com/
// @version      1.0.1
// @description  勾选工单后，按规则表自动匹配处理人员，一键完成批量转派
// @author       jiebukai
// @match        https://css.cloud.inspur.com/platform/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 防止重复注入（刷新页面或脚本被多次加载时只保留一个实例）
  if (window.__cssAutoTransferLoaded) return;
  window.__cssAutoTransferLoaded = true;

  /* ======================= 配置区（按需修改） ======================= */

  const CONFIG = {
    // 转派时填入「处理描述」的固定内容
    description: '请老师处理',

    /**
     * 人员对照表：从上到下匹配，命中第一条即停止。
     * match 的 key 必须与表格表头文字完全一致（见工单列表列名），
     * value 支持：
     *   - 字符串：列值「包含」该字符串即命中
     *   - 正则：列值需匹配该正则
     * 多列条件为「且」关系。
     */
    rules: [
      // 示例规则：请改成你自己的对照表
      { match: { '云中心': '重庆云中心' }, user: 'malei07' },
      { match: { '云中心': '四川省直云中心' }, user: 'yinhang01' },
      // { match: { '工单标题': '网络' }, user: 'zhangsan' },
      // { match: { '一级分类': /派工单|中心需求/ }, user: 'lisi' },
    ],

    // 有工单未命中规则时：'stop' 中止整批 / 'skip' 跳过未命中的
    onNoMatch: 'stop',
  };

  /* ============================ 工具函数 ============================ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  // 注意：不能只用 offsetParent 判断，弹窗是 position:fixed，offsetParent 为 null
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  async function waitFor(fn, timeout = 8000, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch (e) { /* 忽略轮询期间的异常 */ }
      await sleep(interval);
    }
    return null;
  }

  function findButton(text, root = document) {
    return [...root.querySelectorAll('button')].find((b) => isVisible(b) && b.innerText.trim() === text) || null;
  }

  // ng-zorro 的下拉项只认完整鼠标事件序列，单纯 click() 不会触发选中
  function dispatchClick(el) {
    ['mousedown', 'mouseup', 'click'].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  }

  /* ========================== 读取表格数据 ========================== */

  function getDataTable() {
    const tables = [...document.querySelectorAll('.ant-table')].filter(
      (t) => isVisible(t) && t.querySelector('tbody tr.ant-table-row .ant-checkbox-input')
    );
    return tables.length ? tables[tables.length - 1] : null;
  }

  function readRows(onlySelected = false) {
    const table = getDataTable();
    if (!table) return [];

    const ths = [...table.querySelectorAll('thead tr:last-child th')].map((th) => th.innerText.trim());
    const rows = [];

    [...table.querySelectorAll('tbody tr.ant-table-row')].forEach((tr) => {
      const cb = tr.querySelector('.ant-checkbox-input');
      if (onlySelected && (!cb || !cb.checked)) return;

      const tds = [...tr.querySelectorAll('td')];
      const data = {};
      tds.forEach((td, i) => {
        const key = ths[i];
        if (key) data[key] = td.innerText.trim();
      });
      data.__id = data['工单编号'] || data['工单标题'] || '未编号工单';
      data.__title = data['工单标题'] || '';
      data.__tr = tr;
      data.__cb = cb;
      rows.push(data);
    });

    return rows;
  }

  const readSelectedRows = () => readRows(true);

  /**
   * 只勾选指定编号的工单，其余取消勾选。
   * 批量转派只对「当前勾选」生效，所以分组转派前必须重设勾选。
   */
  async function reselect(ids) {
    // 列表可能在上一批转派后重建，先等目标工单出现在表格里
    await waitFor(() => {
      const rows = readRows(false);
      return rows.length && ids.some((id) => rows.some((r) => r.__id === id)) ? rows : null;
    }, 6000);

    const wanted = new Set(ids);
    const rows = readRows(false);

    for (const row of rows) {
      if (!row.__cb) continue;
      const should = wanted.has(row.__id);
      if (row.__cb.checked !== should) {
        row.__cb.click();
        await sleep(120);
      }
    }
    await sleep(300);

    const selected = readSelectedRows().map((r) => r.__id);
    const missing = ids.filter((id) => !selected.includes(id));
    if (missing.length) {
      throw new Error(`勾选失败，以下工单不在当前列表或无法勾选：${missing.join('、')}`);
    }
  }

  function matchUser(row) {
    for (const rule of CONFIG.rules) {
      if (!rule || !rule.user || !rule.match) continue;
      let hit = true;
      for (const [col, expect] of Object.entries(rule.match)) {
        const val = row[col] == null ? '' : String(row[col]);
        if (expect instanceof RegExp) {
          if (!expect.test(val)) { hit = false; break; }
        } else if (!val.includes(String(expect))) {
          hit = false; break;
        }
      }
      if (hit) return rule.user;
    }
    return null;
  }

  /* ============================== UI ============================== */

  let host = null;
  let shadow = null;
  let fab = null;
  let confirmBox = null;
  let toastEl = null;
  let running = false;

  function ensureUI() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = 'css-auto-transfer-host';
    host.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483000;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
        #fab {
          display: none; padding: 10px 18px; border: 0; border-radius: 22px;
          background: #1677ff; color: #fff; font-size: 14px; cursor: pointer;
          box-shadow: 0 4px 14px rgba(22, 119, 255, .35);
        }
        #fab:hover { background: #4096ff; }
        #fab[disabled] { background: #8fbcf7; cursor: not-allowed; }
        #mask {
          position: fixed; inset: 0; background: rgba(0, 0, 0, .45);
          display: none; align-items: center; justify-content: center; z-index: 10;
        }
        #mask.show { display: flex; }
        #dialog {
          width: 520px; max-height: 76vh; background: #fff; border-radius: 8px;
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: 0 8px 30px rgba(0, 0, 0, .2);
        }
        #dialog h3 { margin: 0; padding: 16px 20px; font-size: 16px; border-bottom: 1px solid #f0f0f0; }
        #dialog .body { padding: 14px 20px; overflow: auto; font-size: 13px; color: #333; }
        #dialog .body table { width: 100%; border-collapse: collapse; }
        #dialog .body th, #dialog .body td {
          text-align: left; padding: 6px 8px; border-bottom: 1px solid #f5f5f5; vertical-align: top;
        }
        #dialog .body th { color: #888; font-weight: 400; white-space: nowrap; }
        #dialog .warn { color: #d4380d; }
        #dialog .actions { padding: 12px 20px; border-top: 1px solid #f0f0f0; text-align: right; }
        #dialog .actions button {
          padding: 6px 16px; margin-left: 8px; border-radius: 4px; font-size: 14px; cursor: pointer;
          border: 1px solid #d9d9d9; background: #fff; color: #333;
        }
        #dialog .actions button.primary { background: #1677ff; border-color: #1677ff; color: #fff; }
        #dialog .actions button[disabled] { opacity: .5; cursor: not-allowed; }
        #toast {
          position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
          max-width: 70vw; padding: 10px 16px; border-radius: 6px; font-size: 13px;
          background: rgba(0, 0, 0, .78); color: #fff; display: none; white-space: pre-wrap;
        }
        #toast.show { display: block; }
        #toast.err { background: #d4380d; }
      </style>
      <button id="fab">自动转派</button>
      <div id="mask">
        <div id="dialog">
          <h3>确认自动转派</h3>
          <div class="body"></div>
          <div class="actions">
            <button id="cancel">取消</button>
            <button id="ok" class="primary">确认执行</button>
          </div>
        </div>
      </div>
      <div id="toast"></div>
    `;
    fab = shadow.getElementById('fab');
    confirmBox = shadow.getElementById('mask');
    toastEl = shadow.getElementById('toast');

    fab.addEventListener('click', onRun);
    shadow.getElementById('cancel').addEventListener('click', () => closeConfirm(false));
    shadow.getElementById('ok').addEventListener('click', () => closeConfirm(true));
  }

  let confirmResolve = null;

  function openConfirm(html, opts = {}) {
    ensureUI();
    const { okText = '确认执行', showOk = true, cancelText = '取消' } = opts;
    shadow.querySelector('#dialog .body').innerHTML = html;
    const okBtn = shadow.getElementById('ok');
    okBtn.textContent = okText;
    okBtn.style.display = showOk ? '' : 'none';
    shadow.getElementById('cancel').textContent = cancelText;
    confirmBox.classList.add('show');
    return new Promise((resolve) => { confirmResolve = resolve; });
  }

  function closeConfirm(value) {
    confirmBox.classList.remove('show');
    if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
  }

  function toast(msg, isError = false) {
    ensureUI();
    toastEl.textContent = msg;
    toastEl.className = 'show' + (isError ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.className = ''; }, 5000);
  }

  /* ============================ 页面操作 ============================ */

  async function pickUser(drawer, account) {
    const selectRoot = drawer.querySelector('nz-select[name="dealSkillsetUser"]');
    if (!selectRoot) throw new Error('未找到「处理人员」选择框');

    // 若已有选中值，先清空，避免残留
    const clearBtn = selectRoot.querySelector('.ant-select-selection__clear');
    if (clearBtn) dispatchClick(clearBtn);

    const selection = selectRoot.querySelector('.ant-select-selection');
    dispatchClick(selection);

    const input = await waitFor(
      () => selectRoot.querySelector('input.ant-select-search__field'),
      3000
    );
    if (!input) throw new Error('人员搜索框未出现');

    input.focus();
    input.value = account;
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: account, inputType: 'insertText',
    }));

    // 搜索是异步过滤，必须等列表真正收敛到少量结果，避免点到完整列表里的旧节点
    const option = await waitFor(() => {
      const dropdowns = [...document.querySelectorAll('.ant-select-dropdown')]
        .filter((d) => isVisible(d));
      const dd = dropdowns[dropdowns.length - 1];
      if (!dd) return null;
      const items = [...dd.querySelectorAll('li')].filter(isVisible);
      const matched = items.filter((li) => li.innerText.includes(`[${account}]`));
      if (matched.length !== 1) return null;
      // 过滤完成时列表通常只剩 1~3 条
      return items.length <= 3 ? matched[0] : null;
    }, 8000);

    if (!option) throw new Error(`人员下拉中没有找到账号 ${account}`);

    option.scrollIntoView({ block: 'nearest' });
    await sleep(200);
    dispatchClick(option);
    await sleep(800);

    const chosen = selectRoot.querySelector('.ant-select-selection-selected-value');
    if (!chosen || !chosen.innerText.includes(account)) {
      throw new Error(`人员 ${account} 未选中`);
    }
  }

  async function fillDescription(drawer, text) {
    const editor = drawer.querySelector('.ql-container .ql-editor');
    if (!editor) throw new Error('未找到「处理描述」编辑器');

    editor.innerHTML = String(text)
      .split('\n')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');

    // Quill 通过 MutationObserver 异步同步到表单模型
    await sleep(500);
  }

  async function waitTransferResult() {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      await sleep(300);

      const errNode = [...document.querySelectorAll('.ant-message-error, .ant-notification-notice-error')]
        .find(isVisible);
      if (errNode) return { ok: false, msg: errNode.innerText.trim() };

      const drawer = document.querySelector('.ant-drawer-open app-workorder-batch-transfer');
      if (!drawer) return { ok: true, msg: '' };
    }
    return { ok: false, msg: '等待结果超时，请到工单列表确认是否转派成功' };
  }

  async function doTransfer(user, description) {
    const openBtn = findButton('批量转派');
    if (!openBtn) throw new Error('未找到「批量转派」按钮，请确认已勾选工单');

    dispatchClick(openBtn);

    const confirmBtn = await waitFor(() => {
      const modal = [...document.querySelectorAll('.ant-modal-wrap')]
        .find((w) => isVisible(w) && /批量转派/.test(w.innerText));
      return modal ? [...modal.querySelectorAll('button')]
        .find((b) => b.innerText.trim() === '确认') : null;
    }, 5000);
    if (!confirmBtn) throw new Error('未出现「是否确认批量转派」弹窗');
    dispatchClick(confirmBtn);

    const drawer = await waitFor(
      () => document.querySelector('.ant-drawer-open app-workorder-batch-transfer'),
      8000
    );
    if (!drawer) throw new Error('转派表单未打开');

    await pickUser(drawer, user);
    await fillDescription(drawer, description);

    const saveBtn = drawer.querySelector('.submit-btn');
    if (!saveBtn) throw new Error('未找到「保存」按钮');
    if (saveBtn.disabled) throw new Error('表单校验未通过，「保存」按钮不可用');

    dispatchClick(saveBtn);
    const result = await waitTransferResult();
    if (!result.ok) throw new Error(result.msg || '转派失败');
  }

  /* ============================ 主流程 ============================ */

  async function onRun() {
    if (running) return;

    const rows = readSelectedRows();
    if (!rows.length) {
      toast('请先勾选要转派的工单', true);
      return;
    }

    const plan = [];
    const missing = [];
    for (const row of rows) {
      const user = matchUser(row);
      if (user) plan.push({ row, user });
      else missing.push(row);
    }

    if (missing.length) {
      const list = missing.map((r) => `<li>${escapeHtml(r.__id)} ${escapeHtml(r.__title)}</li>`).join('');
      const html = `
        <p class="warn">以下 ${missing.length} 张工单没有命中任何规则：</p>
        <ul>${list}</ul>
        <p>请在脚本配置区的 rules 中补充对照关系后再试。</p>
      `;
      await openConfirm(html, { showOk: false, cancelText: '知道了' });
      return;
    }

    // 按人员分组：系统的批量转派一次只能指定一个人，所以不同人员要分批执行
    const groups = new Map();
    for (const p of plan) {
      if (!groups.has(p.user)) groups.set(p.user, []);
      groups.get(p.user).push(p);
    }
    const desc = CONFIG.description;

    const rowsHtml = plan.map((p) => `
      <tr>
        <td>${escapeHtml(p.row.__id)}</td>
        <td>${escapeHtml(p.row.__title)}</td>
        <td>${escapeHtml(p.user)}</td>
      </tr>
    `).join('');

    const groupSummary = [...groups.entries()]
      .map(([user, items]) => `<li>${escapeHtml(user)}：${items.length} 张</li>`)
      .join('');

    const html = `
      <p>共 <b>${plan.length}</b> 张工单，按人员分 <b>${groups.size}</b> 批转派：</p>
      <ul>${groupSummary}</ul>
      <table>
        <thead><tr><th>工单编号</th><th>工单标题</th><th>处理人员</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin-top:12px;color:#888">处理描述：${escapeHtml(desc)}</p>
    `;

    const ok = await openConfirm(html);
    if (!ok) return;

    running = true;
    fab.disabled = true;

    const done = [];
    const failed = [];

    try {
      let index = 0;
      for (const [user, items] of groups) {
        index += 1;
        fab.textContent = `转派中 ${index}/${groups.size}：${user}`;

        try {
          // 每次执行前按当前表格重新勾选，避免列表刷新后行元素失效
          await reselect(items.map((p) => p.row.__id));
          await doTransfer(user, desc);
          done.push({ user, items });
          // 等列表刷新稳定后再处理下一组
          await sleep(1200);
        } catch (e) {
          failed.push({ user, items, message: e.message });
          break;
        }
      }
    } finally {
      running = false;
      fab.disabled = false;
      updateFab();
    }

    if (failed.length) {
      const f = failed[0];
      const left = groups.size - done.length;
      toast(
        `已转派 ${done.reduce((n, d) => n + d.items.length, 0)} 张；` +
        `转给 ${f.user} 时失败：${f.message}` +
        (left > 1 ? `（还有 ${left - 1} 批未执行）` : ''),
        true
      );
      return;
    }

    const total = done.reduce((n, d) => n + d.items.length, 0);
    toast(`已成功转派 ${total} 张工单（${groups.size} 批）`);
  }

  /* =========================== 按钮联动 =========================== */

  function updateFab() {
    ensureUI();
    if (running) return;
    const n = readSelectedRows().length;
    fab.style.display = n ? 'inline-block' : 'none';
    fab.textContent = `自动转派 (${n})`;
  }

  let updateTimer = null;
  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(updateFab, 200);
  }

  function init() {
    ensureUI();
    updateFab();
    document.addEventListener('change', scheduleUpdate, true);
    document.addEventListener('click', scheduleUpdate, true);
    new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true });
    setInterval(scheduleUpdate, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
