/**
 * 冒烟测试：用最小 DOM / IndexedDB / CSSOM stub 在 Node 里加载抖音脚本产物。
 *
 * 为什么需要：脚本是 esbuild 打包产物、改动只能靠静态校验 + 你手测；而
 * 「推送记录」这一层在**脚本加载期**就会执行（`_PushHistory.init()`），
 * 一旦它在加载期抛错，整个脚本（推送 / 下载）都会失效 —— 这层测试就是防这个。
 *
 * 只依赖 node:vm / node:test，零第三方依赖。运行：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, '抖音作品推送到eagle.user.js');

/* ------------------------------ CSSOM stub ------------------------------ */
class FakeStyleSheet {
  constructor() { this.cssRules = []; }
  insertRule(rule, index) {
    this.cssRules.splice(index == null ? this.cssRules.length : index, 0, rule);
    return 0;
  }
  deleteRule(i) { this.cssRules.splice(i, 1); }
  replaceSync(text) { this.cssRules = [String(text)]; }
  replace() { return Promise.resolve(this); }
}

/* ------------------------------- DOM stub ------------------------------- */
class El {
  constructor(tag) {
    this.nodeType = 1; // preact 依赖
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = { getPropertyValue: () => '', setProperty() {} };
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.classList = { add() {}, remove() {}, contains: () => false, toggle() {} };
    this.sheet = new FakeStyleSheet();
    this.adoptedStyleSheets = [];
  }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { this.children.push(...cs); }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  insertBefore(c, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  replaceChildren(...cs) { this.children = cs; }
  remove() {}
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  removeAttribute(k) { this.attributes.delete(k); }
  hasAttribute(k) { return this.attributes.has(k); }
  attachShadow() { return new El('#shadow-root'); }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches() { return false; }
  contains() { return false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  get textContent() {
    return this.children
      .map((c) => (c && c.nodeType === 3 ? String(c.nodeValue || '') : c && c.textContent ? c.textContent : ''))
      .join('');
  }
  set textContent(v) {
    this.children = v === '' || v == null ? [] : [{ nodeType: 3, nodeValue: String(v), isConnected: true }];
  }
  get innerHTML() { return ''; }
  set innerHTML(_v) {}
  get innerText() { return ''; }
  set innerText(_v) {}
  get childNodes() { return this.children; } // preact 依赖
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get parentNode() { return null; }
  get parentElement() { return null; }
  get nextSibling() { return null; }
  get previousSibling() { return null; }
  get isConnected() { return true; }
  get shadowRoot() { return null; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
}

/* --------------------------- IndexedDB stub --------------------------- */
function makeRequest(result) {
  const req = { result, error: null, onsuccess: null, onerror: null };
  setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
  return req;
}

function makeStore(map, name = '') {
  const store = {
    getAll: () => makeRequest(Array.from(map.values())),
    get: (k) => makeRequest(map.get(k)),
    count: () => makeRequest(map.size),
    put: (v) => { map.set(v.key, v); return makeRequest(undefined); },
    delete: (k) => { map.delete(k); return makeRequest(undefined); },
    clear: () => { map.clear(); return makeRequest(undefined); },
    createIndex: () => ({}),
  };
  // 推送记录库带 by-pushedAt 索引：让清理走「索引游标」这条生产路径，而不是全量扫描兜底
  if (name === 'push-records') {
    store.indexNames = { contains: (n) => n === 'by-pushedAt' };
    store.index = () => ({
      openCursor: () => {
        const rows = Array.from(map.values()).sort((a, b) => (a.pushedAt || 0) - (b.pushedAt || 0));
        let i = 0;
        const req = { result: null, error: null, onsuccess: null, onerror: null };
        const emit = () => setTimeout(() => {
          if (i >= rows.length) {
            req.result = null;
          } else {
            const row = rows[i];
            req.result = {
              value: row,
              primaryKey: row.key,
              delete: () => { map.delete(row.key); },
              continue: () => { i += 1; emit(); },
            };
          }
          if (req.onsuccess) req.onsuccess();
        }, 0);
        emit();
        return req;
      },
    });
  }
  return store;
}

/** 极简但语义正确（onupgradeneeded → onsuccess、事务 oncomplete）的假 IndexedDB */
function makeFakeIDB() {
  const stores = new Map();
  return {
    open(_name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        const db = {
          version,
          objectStoreNames: { contains: (n) => stores.has(n) },
          createObjectStore(name) {
            stores.set(name, new Map());
            return { createIndex: () => ({}) };
          },
          transaction(name) {
            const map = stores.get(name) || new Map();
            const tx = { oncomplete: null, onerror: null, onabort: null, objectStore: () => makeStore(map, name) };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 1);
            return tx;
          },
        };
        req.result = db;
        // 升级回调里的 request.transaction 用于给已存在的 store 补索引
        req.transaction = { objectStore: (n) => makeStore(stores.get(n) || new Map(), n) };
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}

/** 模拟「另一个标签页还开着老版本连接，导致版本升级被堵住」：open 只抛 blocked，永不成功 */
function makeBlockedIDB() {
  return {
    open() {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        if (req.onblocked) req.onblocked();
      }, 0);
      return req;
    },
  };
}

/** 最小的 Eagle 本地 API 假服务：只用 v1 路由（v2 app info 直接 404 让脚本回退 v1） */
function makeFakeEagle(options = {}) {
  const state = { folders: [], created: [], listCalls: 0, addCalls: 0, items: [], lookupCalls: 0, addLog: [], gate: 0 };
  // gate > 0 时：素材要等第 gate 次 item/list 查询之后才算入库（模拟 Eagle 还在下载）
  if (typeof options.gate === 'number') state.gate = options.gate;
  const gm = (opts) => {
    const url = String(opts.url || '');
    let status = 200;
    let payload = { status: 'success', data: {} };
    if (url.includes('/api/v2/app/info')) {
      status = 404;
      payload = { status: 'error', message: 'not found' };
    } else if (url.includes('/api/application/info')) {
      payload = { status: 'success', data: { version: '4.0.0' } };
    } else if (url.includes('/api/folder/list')) {
      state.listCalls += 1;
      payload = { status: 'success', data: state.folders };
    } else if (url.includes('/api/folder/create')) {
      const body = JSON.parse(opts.data || '{}');
      const name = String(body.folderName || '');
      state.created.push(name);
      payload = { status: 'success', data: { id: 'new-' + state.created.length } };
    } else if (url.includes('/api/item/addFromURL')) {
      state.addCalls += 1;
      const body = JSON.parse(opts.data || '{}');
      state.addLog.push({ name: body.name, website: body.website });
      // 入队时先记在 pending 里，查询到足够次数后才「下载完成」进入素材库
      state.pending = state.pending || [];
      state.pending.push({ url: body.website, name: body.name });
      payload = { status: 'success', data: true };
    } else if (url.includes('/api/item/list')) {
      state.lookupCalls += 1;
      if (state.gate > 0 && state.lookupCalls >= state.gate && state.pending) {
        state.items.push(...state.pending);
        state.pending = [];
      }
      payload = { status: 'success', data: state.items };
    } else if (url.includes('/api/item/addFromURL')) {
      payload = { status: 'success', data: true };
    } else {
      status = 404;
      payload = { status: 'error', message: 'not found' };
    }
    setTimeout(() => {
      if (opts.onload) opts.onload({ status, responseText: JSON.stringify(payload) });
    }, 0);
    return {};
  };
  return { state, gm };
}

/* ------------------------------ 运行产物 ------------------------------ */
class URLSearchParamsStub {
  constructor(init) {
    this._map = new Map();
    const text = typeof init === 'string' ? init.replace(/^\?/, '') : '';
    for (const pair of text.split('&')) {
      if (!pair) continue;
      const [k, v = ''] = pair.split('=');
      this._map.set(decodeURIComponent(k), decodeURIComponent(v));
    }
  }
  get(k) { return this._map.has(k) ? this._map.get(k) : null; }
  getAll(k) { return this._map.has(k) ? [this._map.get(k)] : []; }
  has(k) { return this._map.has(k); }
  set(k, v) { this._map.set(String(k), String(v)); }
  append(k, v) { this._map.set(String(k), String(v)); }
  delete(k) { this._map.delete(k); }
  toString() { return Array.from(this._map, ([k, v]) => `${k}=${v}`).join('&'); }
}

function runUserscript({ withIndexedDB = true, idb = null, ls = null, gm = null } = {}) {
  const code = readFileSync(ARTIFACT, 'utf8');
  const lsData = new Map(ls ? Object.entries(ls) : []);
  const sandbox = {
    console: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
    navigator: { userAgent: 'node-stub', language: 'zh-CN', languages: ['zh-CN'] },
    location: {
      href: 'https://www.douyin.com/video/7301234567890123456',
      pathname: '/video/7301234567890123456',
      hostname: 'www.douyin.com',
      origin: 'https://www.douyin.com',
      search: '',
    },
    localStorage: {
      getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
      setItem: (k, v) => { lsData.set(k, String(v)); },
      removeItem: (k) => { lsData.delete(k); },
      clear: () => lsData.clear(),
      key: () => null,
      get length() { return lsData.size; },
    },
    CSSStyleSheet: FakeStyleSheet,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    GM_xmlhttpRequest: gm || (() => {}),
    // 定时器 / 帧回调在测试里一律不执行：产物里有基于 setTimeout 的轮询，
    // 若同步立即执行会形成递归死循环（实测会导致 node --test 超时）。
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    requestIdleCallback: () => 1,
    cancelIdleCallback: () => {},
    getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    URL: Object.assign(
      class {
        constructor(raw) {
          this.href = String(raw);
          this.pathname = String(raw).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
          this.search = String(raw).includes('?') ? String(raw).slice(String(raw).indexOf('?')) : '';
          this.searchParams = new URLSearchParamsStub(this.search);
          this.origin = '';
        }
      },
      { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} }
    ),
    URLSearchParams: URLSearchParamsStub,
    fetch: () => Promise.reject(new Error('stub: fetch 不可用')),
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    alert: () => {},
    scrollTo: () => {},
    open: () => null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;

  const doc = {
    documentElement: new El('html'),
    head: new El('head'),
    body: new El('body'),
    readyState: 'complete',
    cookie: '',
    title: '',
    adoptedStyleSheets: [],
    styleSheets: [],
    createElement: (t) => {
      const el = new El(t);
      if (String(t).toLowerCase() === 'style') el.sheet = new FakeStyleSheet();
      return el;
    },
    createTextNode: (t) => ({ nodeType: 3, nodeValue: t, isConnected: true }),
    createElementNS: (_ns, t) => {
      const el = new El(t);
      if (String(t).toLowerCase() === 'style') el.sheet = new FakeStyleSheet();
      return el;
    },
    createComment: (t) => ({ nodeType: 8, nodeValue: t, isConnected: true }),
    createDocumentFragment: () => new El('#fragment'),
    createTreeWalker: () => ({ nextNode: () => null }),
    getElementById: () => null,
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    exitFullscreen: () => Promise.resolve(),
    fullscreenElement: null,
  };
  sandbox.document = doc;
  if (idb) sandbox.indexedDB = idb;
  else if (withIndexedDB) sandbox.indexedDB = makeFakeIDB();

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: ARTIFACT });
  return sandbox;
}

/* --------------------------------- 用例 --------------------------------- */
test('产物能在 DOM stub 里加载，且 __dyPush 就位', () => {
  const sb = runUserscript();
  assert.ok(sb.__dyPush, 'window.__dyPush 未暴露 —— 记录层初始化可能抛错');
  // TM 沙箱下页面控制台看不到沙箱 window，真实场景靠这条路径访问
  assert.ok(sb.document.documentElement.__dyPush, 'document.documentElement.__dyPush 未暴露');
  assert.equal(typeof sb.__dyPush.list, 'function');
  assert.equal(typeof sb.__dyPush.stats, 'function');
});

test('空库下记录层可正常使用（init / count / list / stats）', async () => {
  const sb = runUserscript();
  const size = await sb.__dyPush.init();
  assert.equal(size, 0, '空库应为 0 条');
  // 注意：vm sandbox 里的 Array 与宿主的 Array 原型不同，deepStrictEqual 会因跨 realm 失败
  assert.equal(sb.__dyPush.list().length, 0);
  assert.equal(sb.__dyPush.count(), 0);
  assert.deepEqual({ ...sb.__dyPush.stats() }, { count: 0, newest: null, oldest: null });
  assert.equal(sb.__dyPush.get('nope'), null);
  assert.equal(sb.__dyPush.has('nope'), false);
});

test('管理 API 调用不抛错（remove / prune / clear）', async () => {
  const sb = runUserscript();
  assert.equal(await sb.__dyPush.remove('7301234567890123456'), true);
  assert.equal(await sb.__dyPush.prune(), 0);
  assert.equal(await sb.__dyPush.clear(), true);
  assert.equal(sb.__dyPush.count(), 0);
});

test('indexedDB 不可用时降级：脚本仍能加载，记录层接口可用但不崩', async () => {
  const sb = runUserscript({ withIndexedDB: false });
  assert.ok(sb.__dyPush, '即使没有 indexedDB，脚本也应加载成功并暴露 __dyPush');
  assert.equal(sb.__dyPush.list().length, 0);
  assert.equal(sb.__dyPush.count(), 0);
  assert.equal(await sb.__dyPush.init(), 0);
  assert.equal(sb.__dyPush.get('x'), null);
});

test('indexedDB 被其他标签页占用时快速降级，不把面板 / 推送卡死', async () => {
  const sb = runUserscript({ idb: makeBlockedIDB() });
  assert.ok(sb.__dyPush, '被占用时脚本仍应加载成功');
  // 2.1.0 的线上 bug：open 永远不 settle → init / 状态加载挂起 → 全选与推送全卡住
  const result = await Promise.race([
    sb.__dyPush.init().then(
      (m) => 'resolved:' + (m ? m.size : 'null'),
      (err) => 'rejected:' + err.message
    ),
    new Promise((r) => setTimeout(() => r('hang'), 3000)),
  ]);
  assert.notEqual(result, 'hang', 'init 不应等待超过 3 秒（实际挂起）');
  assert.equal(sb.__dyPush.count(), 0);
  assert.equal(sb.__dyPush.get('7301234567890123456'), null);
});

test('文件夹改名 / 被删除后按名字重新解析，不会把作品丢进「未分类」', async () => {
  const { state, gm } = makeFakeEagle();
  state.folders = [{ id: 'f1', name: '作者甲' }, { id: 'p1', name: '父目录' }];
  const sb = runUserscript({ gm });
  // 1) 已有同名文件夹 → 直接复用
  assert.equal(await sb.__dyPush.resolveAuthorFolder('作者甲', '', 'b1'), 'f1');
  // 2) 用户在 Eagle 里把文件夹改成作者的新名字 → 新批次仍复用同一个 id（不能新建）
  state.folders = [{ id: 'f1', name: '作者乙' }, { id: 'p1', name: '父目录' }];
  assert.equal(await sb.__dyPush.resolveAuthorFolder('作者乙', '', 'b2'), 'f1');
  assert.deepEqual(state.created, [], '改名后不应新建文件夹');
  // 3) 文件夹被删掉 → 新批次必须重新创建，而不是把已失效的 id 传回 Eagle
  state.folders = [{ id: 'p1', name: '父目录' }];
  assert.equal(await sb.__dyPush.resolveAuthorFolder('作者乙', '', 'b3'), 'new-1');
  assert.deepEqual(state.created, ['作者乙']);
  assert.ok(state.listCalls >= 4, '每个新批次都应重新拉取文件夹树');
});

test('详情页滚到下一个作品后，解析出的作品与地址栏对齐（不会重推上一个）', async () => {
  const { state, gm } = makeFakeEagle();
  const sb = runUserscript({ gm });
  const staleMedia = { awemeId: '7300000000000000001', desc: '作品1', video: {} };
  const freshMedia = { awemeId: '7301234567890123456', desc: '作品2', images: [{}] };
  // 前两次读播放器还是旧作品（模拟刚滚过去、播放器状态还没跟上）
  let reads = 0;
  const box = { value: freshMedia };
  const player = {};
  Object.defineProperty(player, 'config', {
    get() {
      reads += 1;
      return { awemeInfo: reads <= 2 ? staleMedia : box.value };
    },
  });
  sb.player = player;
  // 让 resolve 里的等待立即推进（默认 stub 的 setTimeout 不回调会一直挂着）
  sb.setTimeout = (fn) => { fn(); return 1; };
  const r = await sb.__dyPush.resolveCurrentMedia(300);
  assert.equal(r.stale, false, '播放器跟上之后不应判定为切换中');
  assert.equal(String(r.media.awemeId), '7301234567890123456');
  assert.equal(String(sb.__dyPush.currentMedia().awemeId), '7301234567890123456');
  assert.equal(state.addCalls, 0);

  // 作者主页上弹层看作品时地址是 /user/xxx?modal_id=…，也要能对上
  const modalMedia = { awemeId: '7301234567890123999', desc: '作品3', video: {} };
  box.value = modalMedia;
  sb.location.pathname = '/user/MS4wLjABAAAA';
  sb.location.search = '?modal_id=7301234567890123999';
  const r2 = await sb.__dyPush.resolveCurrentMedia(0);
  assert.equal(String(r2.expected), '7301234567890123999', '主页弹层要按 modal_id 取当前作品');
  assert.equal(r2.stale, false);
});

test('作品切换中按快捷键：明确提示且不调用 Eagle（避免重复推送）', async () => {
  const { state, gm } = makeFakeEagle();
  const sb = runUserscript({ gm });
  const staleMedia = { awemeId: '7300000000000000001', desc: '作品1', video: {} };
  sb.player = { config: { awemeInfo: staleMedia } };
  sb.setTimeout = (fn) => { fn(); return 1; };
  const r = await sb.__dyPush.resolveCurrentMedia(120);
  assert.equal(r.stale, true, '地址栏是作品2、播放器还停在作品1，应判定为切换中');
  assert.equal(String(r.expected), '7301234567890123456');
  const pushed = await sb.__dyPush.pushCurrent(120);
  assert.equal(pushed.ok, false, '切换中应直接拒绝推送');
  assert.equal(state.addCalls, 0, '切换中不应调用 Eagle 写入（否则会重复推送上一个作品）');
});

test('作者主页批量选择：框选命中判定与选择集操作', () => {
  const sb = runUserscript();
  const sel = sb.__dyPush.selection;
  const cards = [
    { id: 'a', rect: { left: 0, top: 0, width: 100, height: 100 } },
    { id: 'b', rect: { left: 110, top: 0, width: 100, height: 100 } },
    { id: 'c', rect: { left: 0, top: 110, width: 100, height: 100 } },
    { id: 'a', rect: { left: 0, top: 0, width: 100, height: 100 } },
  ];
  // 框住 a 的右下角与 b 的左上角
  assert.deepEqual(Array.from(sel.pickInRect(cards, { left: 50, top: 50, width: 100, height: 100 })), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(sel.pickInRect(cards, { left: 130, top: 10, width: 20, height: 20 })), ['b']);
  // 零尺寸 / 完全在框外 → 不命中
  assert.deepEqual(Array.from(sel.pickInRect(cards, { left: 400, top: 400, width: 0, height: 0 })), []);
  assert.deepEqual(Array.from(sel.pickInRect(cards, { left: 300, top: 300, width: 50, height: 50 })), []);
  // 连选：区间含两端，反向也行，找不到任一端返回空
  assert.deepEqual(Array.from(sel.rangeOfIds(['a', 'b', 'c', 'd'], 'a', 'c')), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(sel.rangeOfIds(['a', 'b', 'c', 'd'], 'd', 'b')), ['b', 'c', 'd']);
  assert.deepEqual(Array.from(sel.rangeOfIds(['a', 'b'], 'a', 'zz')), []);
  // 替换 / 追加 / 减选
  sel.set(['x', 'y']);
  assert.equal(sel.count(), 2);
  sel.add(['y', 'z']);
  assert.deepEqual(Array.from(sel.ids()).sort(), ['x', 'y', 'z']);
  sel.remove(['x']);
  assert.deepEqual(Array.from(sel.ids()).sort(), ['y', 'z']);
  sel.set([]);
  assert.equal(sel.count(), 0);
});

test('作者主页批量执行顺序：按用户选中的先后，而不是页面顺序', () => {
  const sb = runUserscript();
  const sel = sb.__dyPush.selection;
  // 先点第 3 张、再点第 1 张、再点第 2 张
  sel.toggle('p3');
  sel.toggle('p1');
  sel.toggle('p2');
  assert.deepEqual(Array.from(sel.order()), ['p3', 'p1', 'p2'], '顺序应是点选先后，不是页面顺序');
  // 取消后重新选中 → 挪到队尾（最后一次选择最后推送）
  sel.toggle('p1');
  assert.deepEqual(Array.from(sel.order()), ['p3', 'p2']);
  sel.toggle('p1');
  assert.deepEqual(Array.from(sel.order()), ['p3', 'p2', 'p1']);
  // 框选一批：整批按卡片顺序追加在已有选择后面
  sel.set(['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.deepEqual(Array.from(sel.order()), ['p1', 'p2', 'p3', 'p4', 'p5']);
  sel.set([]);
  assert.deepEqual(Array.from(sel.order()), []);
});

test('批量任务真正入队的顺序：与选中顺序一致（不是页面从上到下）', async () => {
  const sb = runUserscript();
  // 产物里的 500ms 间隔、轮询等都靠 setTimeout，沙箱默认不执行 → 这里改成同步执行
  sb.setTimeout = (fn) => { fn(); return 1; };
  sb.location.pathname = '/user/MS4wLjABAAAA';
  sb.location.href = 'https://www.douyin.com/user/MS4wLjABAAAA';
  sb.location.search = '';
  const dm = sb.__dyPush.downloadManager();
  const calls = [];
  // 把真正的下载/推送动作替换成记录调用顺序：只验证队列顺序
  dm._downloadOne = async (awemeId) => { calls.push(String(awemeId)); };
  // 先让主页状态加载完成（首次加载会重置本会话状态，此时还没选东西）
  await dm.collect();
  const sel = sb.__dyPush.selection;
  sel.toggle('7300000000000000003');
  sel.toggle('7300000000000000001');
  sel.toggle('7300000000000000005');
  await dm.startJob('content', 1, 'eagle');
  assert.deepEqual(calls, ['7300000000000000003', '7300000000000000001', '7300000000000000005'],
    '批量推送应按选中先后执行，而不是按页面顺序');
});

/* ------------------ 推送记录层：瘦身 / 轻量索引 / 清理 / 升级 ------------------ */
const DAY = 24 * 60 * 60 * 1000;

/** 先造一个 v2 形态的库（push-records 已存在、无 pushedAt 索引、记录带老字段） */
function seedLegacyDB(idb, rows, storeName = 'push-records') {
  return new Promise((resolve) => {
    const req = idb.open('dy-dl-profile-download-state', 2);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(storeName, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve(req.result);
    };
  });
}

test('记录瘦身：作品名截断、不再落盘 pageUrl/itemIds，导出时补齐 pageUrl', async () => {
  const sb = runUserscript();
  const longName = '很长的作品名'.repeat(20);
  const n = await sb.__dyPush.importRecords([
    {
      awemeId: '7300000000000000001',
      pushedAt: Date.now(),
      pushCount: 2,
      name: longName,
      pageUrl: 'https://www.douyin.com/video/7300000000000000001',
      itemIds: ['a'],
      apiStyle: 'v1',
    },
  ]);
  assert.equal(n, 1);
  assert.equal(sb.__dyPush.count(), 1);
  const entry = sb.__dyPush.get('7300000000000000001');
  assert.ok(entry, '轻量索引里应能同步命中');
  assert.equal(entry.pushCount, 2);
  assert.equal(entry.pageUrl, undefined, '轻量索引不应保存 pageUrl');
  const data = await sb.__dyPush.exportData();
  assert.equal(data.version, 2);
  assert.equal(data.records.length, 1);
  assert.ok(data.records[0].name.length <= 60, '落盘记录的作品名应截断到 60 字');
  assert.equal(data.records[0].pageUrl, 'https://www.douyin.com/video/7300000000000000001');
  assert.equal(data.records[0].itemIds, undefined, 'itemIds 不再落盘');
  assert.equal(sb.__dyPush.cfg().cap, 50000, '默认上限 50000');
});

test('TTL 清理只删过期记录，索引与落盘同步', async () => {
  const sb = runUserscript();
  const now = Date.now();
  await sb.__dyPush.importRecords([
    { awemeId: '7300000000000000101', pushedAt: now - 400 * DAY, name: 'old-1' },
    { awemeId: '7300000000000000102', pushedAt: now - 366 * DAY, name: 'old-2' },
    { awemeId: '7300000000000000103', pushedAt: now - 10 * DAY, name: 'fresh' },
  ]);
  // 导入完成后会自动清一次，这里再显式清一次应当是 0
  assert.equal(await sb.__dyPush.prune(), 0);
  assert.equal(sb.__dyPush.count(), 1);
  assert.equal(await sb.__dyPush.diskCount(), 1);
  assert.deepEqual(
    Array.from(sb.__dyPush.list(), (r) => r.awemeId),
    ['7300000000000000103']
  );
});

test('大数据量：3000 条导入后索引 / 落盘一致，列表按时间倒序', async () => {
  const sb = runUserscript();
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 3000; i += 1) {
    rows.push({
      awemeId: '730' + String(1000000000000000 + i),
      pushedAt: now - i * 1000,
      name: 'v' + i,
    });
  }
  assert.equal(await sb.__dyPush.importRecords(rows), 3000);
  assert.equal(sb.__dyPush.count(), 3000);
  assert.equal(sb.__dyPush.list().length, 3000);
  assert.equal(await sb.__dyPush.diskCount(), 3000);
  assert.equal(sb.__dyPush.stats().count, 3000);
  assert.equal(sb.__dyPush.list()[0].awemeId, '730' + String(1000000000000000), '最新的应排在最前');
});

test('v2 旧库升级到 v3：老记录仍可读（多出的字段被忽略）', async () => {
  const idb = makeFakeIDB();
  await seedLegacyDB(idb, [
    {
      key: 'douyin:7300000000000000201',
      platform: 'douyin',
      awemeId: '7300000000000000201',
      pushedAt: Date.now() - 1000,
      pushCount: 3,
      folderId: 'F1',
      folderName: '老文件夹',
      name: '老记录',
      pageUrl: 'https://www.douyin.com/video/7300000000000000201',
      itemIds: ['x'],
      apiStyle: 'v1',
    },
  ]);
  const sb = runUserscript({ idb });
  assert.equal(await sb.__dyPush.init(), 1, '升级后老记录应保留');
  const rec = sb.__dyPush.get('7300000000000000201');
  assert.equal(rec.pushCount, 3);
  assert.equal(rec.folderName, '老文件夹');
  assert.equal(await sb.__dyPush.diskCount(), 1);
});

test('上限可配置：超限时按 pushedAt 索引游标先删最老的', async () => {
  // 把上限调到 2 条：配置存在 localStorage 的 __douyin-dl-user-js__
  const sb = runUserscript({
    ls: {
      '__douyin-dl-user-js__': JSON.stringify({
        features: { downloader_config: { eagle: { push_record_cap: 2 } } },
      }),
    },
  });
  assert.equal(sb.__dyPush.cfg().cap, 2);
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    rows.push({ awemeId: '73000000000000003' + i, pushedAt: now - i * 1000, name: 'r' + i });
  }
  await sb.__dyPush.importRecords(rows);
  assert.equal(sb.__dyPush.count(), 2, '内存索引应只剩上限条数');
  assert.equal(await sb.__dyPush.diskCount(), 2, '落盘也应被清理');
  assert.deepEqual(
    Array.from(sb.__dyPush.list(), (r) => r.awemeId),
    ['730000000000000030', '730000000000000031'],
    '保留最新的两条'
  );
});

test('严格顺序：上一件还没进 Eagle 素材库时不会推下一件', async () => {
  // gate=3：前两次查询查不到，第三次才「下载完成」——模拟 Eagle 还在排队下载
  const { state, gm } = makeFakeEagle({ gate: 3 });
  const sb = runUserscript({ gm });
  // 虚拟时钟：每读一次 Date.now() 前进 1 秒，让等待循环有明确终点（不会真的空转 180 秒）
  let virtualNow = 1700000000000;
  sb.Date = class extends Date {
    static now() { return (virtualNow += 1000); }
  };
  // 沙箱里的 setTimeout 默认不回调，等待循环会永远挂着 → 这里同步执行
  sb.setTimeout = (fn) => { fn(); return 1; };
  const downloader = sb.__dyPush.downloadManager().mediaHandler.downloader;
  const media = { awemeId: '7300000000000000001', desc: '作品1', video: {}, authorInfo: { nickname: '作者' } };
  const res = await downloader.download_one_url('https://v3-web.douyinvod.com/x.mp4', '作品1.mp4', {
    media,
    mediaType: 'video',
    downloaderOverride: 'eagle',
    strictOrder: true
  });
  assert.equal(res.ok, true);
  assert.equal(state.addCalls, 1);
  assert.ok(state.lookupCalls >= 3, '应轮询到素材真正入库（实际 ' + state.lookupCalls + ' 次）');
  assert.equal(state.items.length, 1, '返回时素材应已在 Eagle 里');
});

test('严格顺序关闭时不再等入库（推送更快，但 Eagle 顺序不保证）', async () => {
  const { state, gm } = makeFakeEagle({ gate: 3 });
  const sb = runUserscript({ gm });
  const downloader = sb.__dyPush.downloadManager().mediaHandler.downloader;
  const media = { awemeId: '7300000000000000002', desc: '作品2', video: {}, authorInfo: { nickname: '作者' } };
  await downloader.download_one_url('https://v3-web.douyinvod.com/y.mp4', '作品2.mp4', {
    media,
    mediaType: 'video',
    downloaderOverride: 'eagle'
  });
  assert.equal(state.addCalls, 1);
  // 只有入库前的查重一次（skip_existing），不会为「等入库」反复轮询
  assert.ok(state.lookupCalls <= 1, '未开启严格顺序时不应轮询入库（实际 ' + state.lookupCalls + ' 次）');
  assert.equal(state.items.length, 0, '没等，所以此刻 Eagle 里还没有这条');
});

test('源码关键片段完整性（防止补丁误删既有代码）', () => {
  const code = readFileSync(ARTIFACT, 'utf8');
  // 脚本是手写源码风格，换行 / 缩进 / 引号都会随格式化变化，比对前统一压平
  const flatten = (text) => text.replace(/\s+/g, ' ').replace(/'/g, '"').trim();
  const haystack = flatten(code);
  const REQUIRED = [
    ['_download_media_logic 的解构行（曾因误删导致推送与下载全废）',
      'const { toastTarget = null, toast = null, toastPrefix = "", alertOnFail = true, addHistory = true, downloaderOverride = "" } = options;'],
    ['推送入口 eagle_push', 'async eagle_push(url, filename_input, options = {}) {'],
    ['下载器分发 download_one_url', 'async download_one_url(url, filename_input, options = {}) {'],
    ['Eagle 分发分支', 'case "eagle":'],
    ['卡片注入幂等类名', 'this.feed_card_selector_cls = "dy-dl-feed-selector"'],
    ['推送记录写入点', 'PushHistory.record(media, options.mediaType'],
    ['记录配置读取函数', 'function readPushCfg()'],
    ['卡片「已推送」徽标类名', 'dy-dl-feed-pushed'],
    ['详情页「已推送」徽标类名', 'dy-dl-video-pushed'],
    ['IndexedDB 名称', 'dy-dl-profile-download-state'],
    ['设置项：Eagle 推送记录独立区（与下载器类型无关）', 'Eagle 推送记录'],
    ['落盘条数自检接口', 'diskCount: () => PushHistory.diskCount()'],
    ['记录上限默认值', 'var PUSH_CAP_DEFAULT = 50000;'],
    ['pushedAt 索引创建（清理按时间游标）', "pushStore.createIndex(PUSH_INDEX_NAME, 'pushedAt');"],
    ['设置项：记录上限下拉', '记录上限'],
    ['导出补齐作品页地址', 'pageUrl: pushPageUrlOf(row.awemeId)'],
    ['当前作品解析（与地址栏对齐，防重推上一件）', 'async resolve_current_media(timeout = 2e3) {'],
    ['滚动/播放时提前重读作品', '_watch_media_switch() {'],
    ['主页弹层按 modal_id 取作品', 'modal_id=(\\d{6,})'],
    ['切换中拒绝推送的提示', '作品还在切换，等 1 秒再按一次快捷键'],
    ['框选命中判定', 'function pickCardsInRect(cards, rect) {'],
    ['连选区间计算', 'function rangeOfIds(ids, from, to) {'],
    ['框选事件安装', '_installFeedMarquee() {'],
    ['框选命中高亮类名', 'dy-dl-marquee-hit'],
    ['面板「反选」按钮', "children: '反选'"],
    ['框选操作提示文案', 'Alt 拖拽减选'],
    ['选中顺序读取（批量任务按它执行）', 'selectionOrder() {'],
    ['Eagle 推送强制串行（保证入库顺序）', 'this._concurrency = isEagleJob ? 1 : this._normalizeConcurrency(concurrency);'],
    ['严格顺序：等待素材入库', 'static async waitUntilIndexed(client, task, options = {}) {'],
    ['严格顺序配置项', 'strictOrder: e.push_strict_order !== false'],
  ];
  const missing = REQUIRED.filter(([, frag]) => !haystack.includes(flatten(frag))).map(([label]) => label);
  assert.deepEqual(missing, [], '源码缺少关键片段：' + missing.join('、'));
});