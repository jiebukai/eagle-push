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

/* ------------------------------ 运行产物 ------------------------------ */function runUserscript({ withIndexedDB = true, idb = null, ls = null } = {}) {
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
    GM_xmlhttpRequest: () => {},
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
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
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
  ];
  const missing = REQUIRED.filter(([, frag]) => !haystack.includes(flatten(frag))).map(([label]) => label);
  assert.deepEqual(missing, [], '源码缺少关键片段：' + missing.join('、'));
});