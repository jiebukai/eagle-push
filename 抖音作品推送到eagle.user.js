// ==UserScript==
// @name            抖音作品推送到eagle
// @namespace       https://github.com/jiebukai/eagle-push
// @version         2.1.1
// @description     把抖音作品（视频/图集）推送到 Eagle 素材库，可选目标文件夹与标签；保留上游的下载能力
// @author          jiebukai
// @match           https://*.douyin.com/*
// @icon            https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico
// @license         MIT
// @supportURL      https://github.com/jiebukai/eagle-push/issues
// @downloadURL     https://raw.githubusercontent.com/jiebukai/eagle-push/main/%E6%8A%96%E9%9F%B3%E4%BD%9C%E5%93%81%E6%8E%A8%E9%80%81%E5%88%B0eagle.user.js
// @updateURL       https://raw.githubusercontent.com/jiebukai/eagle-push/main/%E6%8A%96%E9%9F%B3%E4%BD%9C%E5%93%81%E6%8E%A8%E9%80%81%E5%88%B0eagle.user.js
// @grant           GM_xmlhttpRequest
// @connect         *
// @homepageURL     https://github.com/jiebukai/eagle-push
// ==/UserScript==
/*
 * 维护：jiebukai（仓库 https://github.com/jiebukai/eagle-push）
 * @namespace / @downloadURL / @updateURL / @supportURL 均指向本仓库，
 * 用于切断与上游脚本的自动更新关联，避免 Tampermonkey 自动更新把本地改动覆盖回上游版本。
 * 原作者与上游来源保留在下方 @author 及原说明中。
 */

/*
 * 本版基于上游 v1.5.15（zhzLuke96/douyin-dl-user-js）增加 Eagle 推送能力：
 *
 * 1. 作品详情页：播放器「插件」菜单里多了「存到 Eagle」，一键把当前作品
 *    （视频或整套图集）推送到 Eagle 素材库。
 * 2. 作者主页：右下角浮动面板新增「存 Eagle」按钮，勾选多个作品后批量推送。
 * 3. 设置 → 下载器配置 → 类型选「Eagle」：填写 Eagle 服务地址
 *    （默认 http://127.0.0.1:41595）、选择目标文件夹与标签。
 *    未选择标签时，素材不会写入任何标签。
 *
 * 实现要点：
 * - Eagle 侧调用 /api/item/addFromURL（Eagle 4.0 桌面版）或 /api/v2/item/add，
 *   运行时自动探测 API 风格并在 404 时回退；
 * - 素材的来源 URL 写作品页地址，annotation 写入作者 / 发布时间 / 作品 ID 便于回溯；
 * - 视频优先使用带签名的 CDN 直链（Eagle 是外部程序、没有浏览器 cookie），
 *   同源 playApi 作为兜底；
 * - 默认按「来源页面 URL + 文件名」跳过 Eagle 中已存在的素材，可在设置里关闭。
 */

/*
 * 代码结构（源码风格，按原 TS 工程模块顺序排列）
 *
 * 本文件由 esbuild 打包产物展平重建：去掉了打包器样板，应用代码已还原成
 * 可直接阅读的普通 JavaScript，逻辑与打包产物逐句等价。改动时按下面的
 * 分区定位即可，每个分区开头都有 `// ─── src/...` 横幅。
 *
 *   1. 第三方依赖        preact 10.28.2（preact / hooks / jsx-runtime），原样内联
 *   2. src/core          Emitter 事件总线、Config 配置
 *   3. src/utils         format / string / storage / css-in-js / theme / dom / performance
 *   4. src/core/download 下载器启动器、下载记录、下载器、批量调度、状态存储
 *   5. src/core/eagle    Eagle 本地 API 客户端
 *   6. src/handlers      抖音页面适配、作品操作、推送记录
 *   7. src/ui            弹窗、浮动面板、快捷键、DOM 修补
 *   8. src/index.ts      启动
 *
 * 约定：
 *   - 配置走 localStorage，推送 / 下载记录走 IndexedDB，不用 GM_setValue；
 *   - 调试入口挂在 document.documentElement.__dyPush（见 src/index 之前的存储层）。
 */

'use strict';

(() => {
  /* ══════════════════════════════════════════════════════════════════════
   * 第三方依赖（原样内联，请勿手改）
   *   preact 10.28.2 · preact/hooks
   * 下面是 preact 官方 dist 构建的代码，压缩后的短标识符保持原样；
   * 只有应用层会用到的公开 API 被还原成可读名字：
   *   _            → createElement
   *   m            → createVNode
   *   x            → Component
   *   k            → Fragment
   *   G            → render
   *   w            → assign
   *   l            → preactOptions
   *   d2 / y2      → useState / useEffect
   *   u3           → jsx（preact/jsx-runtime）
   * ══════════════════════════════════════════════════════════════════════ */
  function assign(n2, l3) {
    for (var u4 in l3) n2[u4] = l3[u4];
    return n2;
  }
  function g(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function createElement(l3, u4, t3) {
    var i3,
      o3,
      r3,
      e3 = {};
    for (r3 in u4) 'key' == r3 ? (i3 = u4[r3]) : 'ref' == r3 ? (o3 = u4[r3]) : (e3[r3] = u4[r3]);
    if (
      (arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t3),
      'function' == typeof l3 && null != l3.defaultProps)
    )
      for (r3 in l3.defaultProps) void 0 === e3[r3] && (e3[r3] = l3.defaultProps[r3]);
    return createVNode(l3, e3, i3, o3, null);
  }
  function createVNode(n2, t3, i3, o3, r3) {
    var e3 = {
      type: n2,
      props: t3,
      key: i3,
      ref: o3,
      __k: null,
      __: null,
      __b: 0,
      __e: null,
      __c: null,
      constructor: void 0,
      __v: null == r3 ? ++u : r3,
      __i: -1,
      __u: 0
    };
    return (null == r3 && null != preactOptions.vnode && preactOptions.vnode(e3), e3);
  }
  function Fragment(n2) {
    return n2.children;
  }
  function Component(n2, l3) {
    ((this.props = n2), (this.context = l3));
  }
  function S(n2, l3) {
    if (null == l3) return n2.__ ? S(n2.__, n2.__i + 1) : null;
    for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
    return 'function' == typeof n2.type ? S(n2) : null;
  }
  function C(n2) {
    var l3, u4;
    if (null != (n2 = n2.__) && null != n2.__c) {
      for (n2.__e = n2.__c.base = null, l3 = 0; l3 < n2.__k.length; l3++)
        if (null != (u4 = n2.__k[l3]) && null != u4.__e) {
          n2.__e = n2.__c.base = u4.__e;
          break;
        }
      return C(n2);
    }
  }
  function M(n2) {
    ((!n2.__d && (n2.__d = true) && i.push(n2) && !$.__r++) || o != preactOptions.debounceRendering) &&
      ((o = preactOptions.debounceRendering) || r)($);
  }
  function $() {
    for (var n2, u4, t3, o3, r3, f4, c4, s5 = 1; i.length;)
      (i.length > s5 && i.sort(e),
        (n2 = i.shift()),
        (s5 = i.length),
        n2.__d &&
          ((t3 = void 0),
          (o3 = void 0),
          (r3 = (o3 = (u4 = n2).__v).__e),
          (f4 = []),
          (c4 = []),
          u4.__P &&
            (((t3 = assign({}, o3)).__v = o3.__v + 1),
            preactOptions.vnode && preactOptions.vnode(t3),
            O(
              u4.__P,
              t3,
              o3,
              u4.__n,
              u4.__P.namespaceURI,
              32 & o3.__u ? [r3] : null,
              f4,
              null == r3 ? S(o3) : r3,
              !!(32 & o3.__u),
              c4
            ),
            (t3.__v = o3.__v),
            (t3.__.__k[t3.__i] = t3),
            N(f4, t3, c4),
            (o3.__e = o3.__ = null),
            t3.__e != r3 && C(t3))));
    $.__r = 0;
  }
  function I(n2, l3, u4, t3, i3, o3, r3, e3, f4, c4, s5) {
    var a3,
      h3,
      y3,
      d3,
      w3,
      g2,
      _2,
      m3 = (t3 && t3.__k) || v,
      b = l3.length;
    for (f4 = P(u4, l3, m3, f4, b), a3 = 0; a3 < b; a3++)
      null != (y3 = u4.__k[a3]) &&
        ((h3 = -1 == y3.__i ? p : m3[y3.__i] || p),
        (y3.__i = a3),
        (g2 = O(n2, y3, h3, i3, o3, r3, e3, f4, c4, s5)),
        (d3 = y3.__e),
        y3.ref && h3.ref != y3.ref && (h3.ref && B(h3.ref, null, y3), s5.push(y3.ref, y3.__c || d3, y3)),
        null == w3 && null != d3 && (w3 = d3),
        (_2 = !!(4 & y3.__u)) || h3.__k === y3.__k
          ? (f4 = A(y3, f4, n2, _2))
          : 'function' == typeof y3.type && void 0 !== g2
            ? (f4 = g2)
            : d3 && (f4 = d3.nextSibling),
        (y3.__u &= -7));
    return ((u4.__e = w3), f4);
  }
  function P(n2, l3, u4, t3, i3) {
    var o3,
      r3,
      e3,
      f4,
      c4,
      s5 = u4.length,
      a3 = s5,
      h3 = 0;
    for (n2.__k = new Array(i3), o3 = 0; o3 < i3; o3++)
      null != (r3 = l3[o3]) && 'boolean' != typeof r3 && 'function' != typeof r3
        ? ('string' == typeof r3 || 'number' == typeof r3 || 'bigint' == typeof r3 || r3.constructor == String
            ? (r3 = n2.__k[o3] = createVNode(null, r3, null, null, null))
            : d(r3)
              ? (r3 = n2.__k[o3] =
                  createVNode(
                    Fragment,
                    {
                      children: r3
                    },
                    null,
                    null,
                    null
                  ))
              : void 0 === r3.constructor && r3.__b > 0
                ? (r3 = n2.__k[o3] = createVNode(r3.type, r3.props, r3.key, r3.ref ? r3.ref : null, r3.__v))
                : (n2.__k[o3] = r3),
          (f4 = o3 + h3),
          (r3.__ = n2),
          (r3.__b = n2.__b + 1),
          (e3 = null),
          -1 != (c4 = r3.__i = L(r3, u4, f4, a3)) && (a3--, (e3 = u4[c4]) && (e3.__u |= 2)),
          null == e3 || null == e3.__v
            ? (-1 == c4 && (i3 > s5 ? h3-- : i3 < s5 && h3++), 'function' != typeof r3.type && (r3.__u |= 4))
            : c4 != f4 && (c4 == f4 - 1 ? h3-- : c4 == f4 + 1 ? h3++ : (c4 > f4 ? h3-- : h3++, (r3.__u |= 4))))
        : (n2.__k[o3] = null);
    if (a3)
      for (o3 = 0; o3 < s5; o3++)
        null != (e3 = u4[o3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = S(e3)), D(e3, e3));
    return t3;
  }
  function A(n2, l3, u4, t3) {
    var i3, o3;
    if ('function' == typeof n2.type) {
      for (i3 = n2.__k, o3 = 0; i3 && o3 < i3.length; o3++) i3[o3] && ((i3[o3].__ = n2), (l3 = A(i3[o3], l3, u4, t3)));
      return l3;
    }
    n2.__e != l3 &&
      (t3 && (l3 && n2.type && !l3.parentNode && (l3 = S(n2)), u4.insertBefore(n2.__e, l3 || null)), (l3 = n2.__e));
    do {
      l3 = l3 && l3.nextSibling;
    } while (null != l3 && 8 == l3.nodeType);
    return l3;
  }
  function L(n2, l3, u4, t3) {
    var i3,
      o3,
      r3,
      e3 = n2.key,
      f4 = n2.type,
      c4 = l3[u4],
      s5 = null != c4 && 0 == (2 & c4.__u);
    if ((null === c4 && null == e3) || (s5 && e3 == c4.key && f4 == c4.type)) return u4;
    if (t3 > (s5 ? 1 : 0)) {
      for (i3 = u4 - 1, o3 = u4 + 1; i3 >= 0 || o3 < l3.length;)
        if (null != (c4 = l3[(r3 = i3 >= 0 ? i3-- : o3++)]) && 0 == (2 & c4.__u) && e3 == c4.key && f4 == c4.type)
          return r3;
    }
    return -1;
  }
  function T(n2, l3, u4) {
    '-' == l3[0]
      ? n2.setProperty(l3, null == u4 ? '' : u4)
      : (n2[l3] = null == u4 ? '' : 'number' != typeof u4 || y.test(l3) ? u4 : u4 + 'px');
  }
  function j(n2, l3, u4, t3, i3) {
    var o3, r3;
    n: if ('style' == l3) {
      if ('string' == typeof u4) n2.style.cssText = u4;
      else {
        if (('string' == typeof t3 && (n2.style.cssText = t3 = ''), t3))
          for (l3 in t3) (u4 && l3 in u4) || T(n2.style, l3, '');
        if (u4) for (l3 in u4) (t3 && u4[l3] == t3[l3]) || T(n2.style, l3, u4[l3]);
      }
    } else if ('o' == l3[0] && 'n' == l3[1])
      ((o3 = l3 != (l3 = l3.replace(f, '$1'))),
        (r3 = l3.toLowerCase()),
        (l3 = r3 in n2 || 'onFocusOut' == l3 || 'onFocusIn' == l3 ? r3.slice(2) : l3.slice(2)),
        n2.l || (n2.l = {}),
        (n2.l[l3 + o3] = u4),
        u4
          ? t3
            ? (u4.u = t3.u)
            : ((u4.u = c), n2.addEventListener(l3, o3 ? a : s, o3))
          : n2.removeEventListener(l3, o3 ? a : s, o3));
    else {
      if ('http://www.w3.org/2000/svg' == i3) l3 = l3.replace(/xlink(H|:h)/, 'h').replace(/sName$/, 's');
      else if (
        'width' != l3 &&
        'height' != l3 &&
        'href' != l3 &&
        'list' != l3 &&
        'form' != l3 &&
        'tabIndex' != l3 &&
        'download' != l3 &&
        'rowSpan' != l3 &&
        'colSpan' != l3 &&
        'role' != l3 &&
        'popover' != l3 &&
        l3 in n2
      )
        try {
          n2[l3] = null == u4 ? '' : u4;
          break n;
        } catch (err) {}
      'function' == typeof u4 ||
        (null == u4 || (false === u4 && '-' != l3[4])
          ? n2.removeAttribute(l3)
          : n2.setAttribute(l3, 'popover' == l3 && 1 == u4 ? '' : u4));
    }
  }
  function F(n2) {
    return function (u4) {
      if (this.l) {
        var t3 = this.l[u4.type + n2];
        if (null == u4.t) u4.t = c++;
        else if (u4.t < t3.u) return;
        return t3(preactOptions.event ? preactOptions.event(u4) : u4);
      }
    };
  }
  function O(n2, u4, t3, i3, o3, r3, e3, f4, c4, s5) {
    var a3,
      h3,
      p3,
      v3,
      y3,
      _2,
      m3,
      b,
      S2,
      C3,
      M2,
      $2,
      P2,
      A3,
      H,
      L2,
      T3,
      j3 = u4.type;
    if (void 0 !== u4.constructor) return null;
    (128 & t3.__u && ((c4 = !!(32 & t3.__u)), (r3 = [(f4 = u4.__e = t3.__e)])), (a3 = preactOptions.__b) && a3(u4));
    n: if ('function' == typeof j3)
      try {
        if (
          ((b = u4.props),
          (S2 = 'prototype' in j3 && j3.prototype.render),
          (C3 = (a3 = j3.contextType) && i3[a3.__c]),
          (M2 = a3 ? (C3 ? C3.props.value : a3.__) : i3),
          t3.__c
            ? (m3 = (h3 = u4.__c = t3.__c).__ = h3.__E)
            : (S2
                ? (u4.__c = h3 = new j3(b, M2))
                : ((u4.__c = h3 = new Component(b, M2)), (h3.constructor = j3), (h3.render = E)),
              C3 && C3.sub(h3),
              h3.state || (h3.state = {}),
              (h3.__n = i3),
              (p3 = h3.__d = true),
              (h3.__h = []),
              (h3._sb = [])),
          S2 && null == h3.__s && (h3.__s = h3.state),
          S2 &&
            null != j3.getDerivedStateFromProps &&
            (h3.__s == h3.state && (h3.__s = assign({}, h3.__s)),
            assign(h3.__s, j3.getDerivedStateFromProps(b, h3.__s))),
          (v3 = h3.props),
          (y3 = h3.state),
          (h3.__v = u4),
          p3)
        )
          (S2 && null == j3.getDerivedStateFromProps && null != h3.componentWillMount && h3.componentWillMount(),
            S2 && null != h3.componentDidMount && h3.__h.push(h3.componentDidMount));
        else {
          if (
            (S2 &&
              null == j3.getDerivedStateFromProps &&
              b !== v3 &&
              null != h3.componentWillReceiveProps &&
              h3.componentWillReceiveProps(b, M2),
            u4.__v == t3.__v ||
              (!h3.__e && null != h3.shouldComponentUpdate && false === h3.shouldComponentUpdate(b, h3.__s, M2)))
          ) {
            for (
              u4.__v != t3.__v && ((h3.props = b), (h3.state = h3.__s), (h3.__d = false)),
                u4.__e = t3.__e,
                u4.__k = t3.__k,
                u4.__k.some(function (n3) {
                  n3 && (n3.__ = u4);
                }),
                $2 = 0;
              $2 < h3._sb.length;
              $2++
            )
              h3.__h.push(h3._sb[$2]);
            ((h3._sb = []), h3.__h.length && e3.push(h3));
            break n;
          }
          (null != h3.componentWillUpdate && h3.componentWillUpdate(b, h3.__s, M2),
            S2 &&
              null != h3.componentDidUpdate &&
              h3.__h.push(function () {
                h3.componentDidUpdate(v3, y3, _2);
              }));
        }
        if (
          ((h3.context = M2), (h3.props = b), (h3.__P = n2), (h3.__e = false), (P2 = preactOptions.__r), (A3 = 0), S2)
        ) {
          for (
            h3.state = h3.__s, h3.__d = false, P2 && P2(u4), a3 = h3.render(h3.props, h3.state, h3.context), H = 0;
            H < h3._sb.length;
            H++
          )
            h3.__h.push(h3._sb[H]);
          h3._sb = [];
        } else
          do {
            ((h3.__d = false), P2 && P2(u4), (a3 = h3.render(h3.props, h3.state, h3.context)), (h3.state = h3.__s));
          } while (h3.__d && ++A3 < 25);
        ((h3.state = h3.__s),
          null != h3.getChildContext && (i3 = assign(assign({}, i3), h3.getChildContext())),
          S2 && !p3 && null != h3.getSnapshotBeforeUpdate && (_2 = h3.getSnapshotBeforeUpdate(v3, y3)),
          (L2 = a3),
          null != a3 && a3.type === Fragment && null == a3.key && (L2 = V(a3.props.children)),
          (f4 = I(n2, d(L2) ? L2 : [L2], u4, t3, i3, o3, r3, e3, f4, c4, s5)),
          (h3.base = u4.__e),
          (u4.__u &= -161),
          h3.__h.length && e3.push(h3),
          m3 && (h3.__E = h3.__ = null));
      } catch (err) {
        if (((u4.__v = null), c4 || null != r3)) {
          if (err.then) {
            for (u4.__u |= c4 ? 160 : 128; f4 && 8 == f4.nodeType && f4.nextSibling;) f4 = f4.nextSibling;
            ((r3[r3.indexOf(f4)] = null), (u4.__e = f4));
          } else {
            for (T3 = r3.length; T3--;) g(r3[T3]);
            z(u4);
          }
        } else ((u4.__e = t3.__e), (u4.__k = t3.__k), err.then || z(u4));
        preactOptions.__e(err, u4, t3);
      }
    else
      null == r3 && u4.__v == t3.__v
        ? ((u4.__k = t3.__k), (u4.__e = t3.__e))
        : (f4 = u4.__e = q(t3.__e, u4, t3, i3, o3, r3, e3, c4, s5));
    return ((a3 = preactOptions.diffed) && a3(u4), 128 & u4.__u ? void 0 : f4);
  }
  function z(n2) {
    (n2 && n2.__c && (n2.__c.__e = true), n2 && n2.__k && n2.__k.forEach(z));
  }
  function N(n2, u4, t3) {
    for (var i3 = 0; i3 < t3.length; i3++) B(t3[i3], t3[++i3], t3[++i3]);
    (preactOptions.__c && preactOptions.__c(u4, n2),
      n2.some(function (u5) {
        try {
          ((n2 = u5.__h),
            (u5.__h = []),
            n2.some(function (n3) {
              n3.call(u5);
            }));
        } catch (err) {
          preactOptions.__e(err, u5.__v);
        }
      }));
  }
  function V(n2) {
    return 'object' != typeof n2 || null == n2 || (n2.__b && n2.__b > 0) ? n2 : d(n2) ? n2.map(V) : assign({}, n2);
  }
  function q(u4, t3, i3, o3, r3, e3, f4, c4, s5) {
    var a3,
      h3,
      v3,
      y3,
      w3,
      _2,
      m3,
      b = i3.props || p,
      k3 = t3.props,
      x2 = t3.type;
    if (
      ('svg' == x2
        ? (r3 = 'http://www.w3.org/2000/svg')
        : 'math' == x2
          ? (r3 = 'http://www.w3.org/1998/Math/MathML')
          : r3 || (r3 = 'http://www.w3.org/1999/xhtml'),
      null != e3)
    ) {
      for (a3 = 0; a3 < e3.length; a3++)
        if ((w3 = e3[a3]) && 'setAttribute' in w3 == !!x2 && (x2 ? w3.localName == x2 : 3 == w3.nodeType)) {
          ((u4 = w3), (e3[a3] = null));
          break;
        }
    }
    if (null == u4) {
      if (null == x2) return document.createTextNode(k3);
      ((u4 = document.createElementNS(r3, x2, k3.is && k3)),
        c4 && (preactOptions.__m && preactOptions.__m(t3, e3), (c4 = false)),
        (e3 = null));
    }
    if (null == x2) b === k3 || (c4 && u4.data == k3) || (u4.data = k3);
    else {
      if (((e3 = e3 && n.call(u4.childNodes)), !c4 && null != e3))
        for (b = {}, a3 = 0; a3 < u4.attributes.length; a3++) b[(w3 = u4.attributes[a3]).name] = w3.value;
      for (a3 in b)
        if (((w3 = b[a3]), 'children' == a3));
        else if ('dangerouslySetInnerHTML' == a3) v3 = w3;
        else if (!(a3 in k3)) {
          if (('value' == a3 && 'defaultValue' in k3) || ('checked' == a3 && 'defaultChecked' in k3)) continue;
          j(u4, a3, null, w3, r3);
        }
      for (a3 in k3)
        ((w3 = k3[a3]),
          'children' == a3
            ? (y3 = w3)
            : 'dangerouslySetInnerHTML' == a3
              ? (h3 = w3)
              : 'value' == a3
                ? (_2 = w3)
                : 'checked' == a3
                  ? (m3 = w3)
                  : (c4 && 'function' != typeof w3) || b[a3] === w3 || j(u4, a3, w3, b[a3], r3));
      if (h3)
        (c4 || (v3 && (h3.__html == v3.__html || h3.__html == u4.innerHTML)) || (u4.innerHTML = h3.__html),
          (t3.__k = []));
      else if (
        (v3 && (u4.innerHTML = ''),
        I(
          'template' == t3.type ? u4.content : u4,
          d(y3) ? y3 : [y3],
          t3,
          i3,
          o3,
          'foreignObject' == x2 ? 'http://www.w3.org/1999/xhtml' : r3,
          e3,
          f4,
          e3 ? e3[0] : i3.__k && S(i3, 0),
          c4,
          s5
        ),
        null != e3)
      )
        for (a3 = e3.length; a3--;) g(e3[a3]);
      c4 ||
        ((a3 = 'value'),
        'progress' == x2 && null == _2
          ? u4.removeAttribute('value')
          : null != _2 &&
            (_2 !== u4[a3] || ('progress' == x2 && !_2) || ('option' == x2 && _2 != b[a3])) &&
            j(u4, a3, _2, b[a3], r3),
        (a3 = 'checked'),
        null != m3 && m3 != u4[a3] && j(u4, a3, m3, b[a3], r3));
    }
    return u4;
  }
  function B(n2, u4, t3) {
    try {
      if ('function' == typeof n2) {
        var i3 = 'function' == typeof n2.__u;
        (i3 && n2.__u(), (i3 && null == u4) || (n2.__u = n2(u4)));
      } else n2.current = u4;
    } catch (err) {
      preactOptions.__e(err, t3);
    }
  }
  function D(n2, u4, t3) {
    var i3, o3;
    if (
      (preactOptions.unmount && preactOptions.unmount(n2),
      (i3 = n2.ref) && ((i3.current && i3.current != n2.__e) || B(i3, null, u4)),
      null != (i3 = n2.__c))
    ) {
      if (i3.componentWillUnmount)
        try {
          i3.componentWillUnmount();
        } catch (err) {
          preactOptions.__e(err, u4);
        }
      i3.base = i3.__P = null;
    }
    if ((i3 = n2.__k)) for (o3 = 0; o3 < i3.length; o3++) i3[o3] && D(i3[o3], u4, t3 || 'function' != typeof n2.type);
    (t3 || g(n2.__e), (n2.__c = n2.__ = n2.__e = void 0));
  }
  function E(n2, l3, u4) {
    return this.constructor(n2, u4);
  }
  function render(u4, t3, i3) {
    var o3, r3, e3, f4;
    (t3 == document && (t3 = document.documentElement),
      preactOptions.__ && preactOptions.__(u4, t3),
      (r3 = (o3 = 'function' == typeof i3) ? null : (i3 && i3.__k) || t3.__k),
      (e3 = []),
      (f4 = []),
      O(
        t3,
        (u4 = ((!o3 && i3) || t3).__k = createElement(Fragment, null, [u4])),
        r3 || p,
        p,
        t3.namespaceURI,
        !o3 && i3 ? [i3] : r3 ? null : t3.firstChild ? n.call(t3.childNodes) : null,
        e3,
        !o3 && i3 ? i3 : r3 ? r3.__e : t3.firstChild,
        o3,
        f4
      ),
      N(e3, u4, f4));
  }
  var n, preactOptions, u, t, i, o, r, e, f, c, s, a, h, p, v, y, d;
  p = {};
  v = [];
  y = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  d = Array.isArray;
  ((n = v.slice),
    (preactOptions = {
      __e: function (n2, l3, u4, t3) {
        for (var i3, o3, r3; (l3 = l3.__);)
          if ((i3 = l3.__c) && !i3.__)
            try {
              if (
                ((o3 = i3.constructor) &&
                  null != o3.getDerivedStateFromError &&
                  (i3.setState(o3.getDerivedStateFromError(n2)), (r3 = i3.__d)),
                null != i3.componentDidCatch && (i3.componentDidCatch(n2, t3 || {}), (r3 = i3.__d)),
                r3)
              )
                return (i3.__E = i3);
            } catch (err) {
              n2 = err;
            }
        throw n2;
      }
    }),
    (u = 0),
    (t = function (n2) {
      return null != n2 && void 0 === n2.constructor;
    }),
    (Component.prototype.setState = function (n2, l3) {
      var u4;
      ((u4 = null != this.__s && this.__s != this.state ? this.__s : (this.__s = assign({}, this.state))),
        'function' == typeof n2 && (n2 = n2(assign({}, u4), this.props)),
        n2 && assign(u4, n2),
        null != n2 && this.__v && (l3 && this._sb.push(l3), M(this)));
    }),
    (Component.prototype.forceUpdate = function (n2) {
      this.__v && ((this.__e = true), n2 && this.__h.push(n2), M(this));
    }),
    (Component.prototype.render = Fragment),
    (i = []),
    (r = 'function' == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout),
    (e = function (n2, l3) {
      return n2.__v.__b - l3.__v.__b;
    }),
    ($.__r = 0),
    (f = /(PointerCapture)$|Capture$/i),
    (c = 0),
    (s = F(false)),
    (a = F(true)),
    (h = 0));
  function p2(n2, t3) {
    (hooksOptions.__h && hooksOptions.__h(currentComponent, n2, o2 || t3), (o2 = 0));
    var u4 =
      currentComponent.__H ||
      (currentComponent.__H = {
        __: [],
        __h: []
      });
    return (n2 >= u4.__.length && u4.__.push({}), u4.__[n2]);
  }
  function useState(n2) {
    return ((o2 = 1), h2(D2, n2));
  }
  function h2(n2, u4, i3) {
    var o3 = p2(t2++, 2);
    if (
      ((o3.t = n2),
      !o3.__c &&
        ((o3.__ = [
          i3 ? i3(u4) : D2(void 0, u4),
          function (n3) {
            var t3 = o3.__N ? o3.__N[0] : o3.__[0],
              r3 = o3.t(t3, n3);
            t3 !== r3 && ((o3.__N = [r3, o3.__[1]]), o3.__c.setState({}));
          }
        ]),
        (o3.__c = currentComponent),
        !currentComponent.__f))
    ) {
      var f4 = function (n3, t3, r3) {
        if (!o3.__c.__H) return true;
        var u5 = o3.__c.__H.__.filter(function (n4) {
          return !!n4.__c;
        });
        if (
          u5.every(function (n4) {
            return !n4.__N;
          })
        )
          return !c4 || c4.call(this, n3, t3, r3);
        var i4 = o3.__c.props !== n3;
        return (
          u5.forEach(function (n4) {
            if (n4.__N) {
              var t4 = n4.__[0];
              ((n4.__ = n4.__N), (n4.__N = void 0), t4 !== n4.__[0] && (i4 = true));
            }
          }),
          (c4 && c4.call(this, n3, t3, r3)) || i4
        );
      };
      currentComponent.__f = true;
      var c4 = currentComponent.shouldComponentUpdate,
        e3 = currentComponent.componentWillUpdate;
      ((currentComponent.componentWillUpdate = function (n3, t3, r3) {
        if (this.__e) {
          var u5 = c4;
          ((c4 = void 0), f4(n3, t3, r3), (c4 = u5));
        }
        e3 && e3.call(this, n3, t3, r3);
      }),
        (currentComponent.shouldComponentUpdate = f4));
    }
    return o3.__N || o3.__;
  }
  function useEffect(n2, u4) {
    var i3 = p2(t2++, 3);
    !hooksOptions.__s && C2(i3.__H, u4) && ((i3.__ = n2), (i3.u = u4), currentComponent.__H.__h.push(i3));
  }
  function A2(n2) {
    return (
      (o2 = 5),
      T2(function () {
        return {
          current: n2
        };
      }, [])
    );
  }
  function T2(n2, r3) {
    var u4 = p2(t2++, 7);
    return (C2(u4.__H, r3) && ((u4.__ = n2()), (u4.__H = r3), (u4.__h = n2)), u4.__);
  }
  function q2(n2, t3) {
    return (
      (o2 = 8),
      T2(function () {
        return n2;
      }, t3)
    );
  }
  function j2() {
    for (var n2; (n2 = f2.shift());)
      if (n2.__P && n2.__H)
        try {
          (n2.__H.__h.forEach(z2), n2.__H.__h.forEach(B2), (n2.__H.__h = []));
        } catch (err) {
          ((n2.__H.__h = []), hooksOptions.__e(err, n2.__v));
        }
  }
  function w2(n2) {
    var t3,
      r3 = function () {
        (clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2));
      },
      u4 = setTimeout(r3, 35);
    k2 && (t3 = requestAnimationFrame(r3));
  }
  function z2(n2) {
    var t3 = currentComponent,
      u4 = n2.__c;
    ('function' == typeof u4 && ((n2.__c = void 0), u4()), (currentComponent = t3));
  }
  function B2(n2) {
    var t3 = currentComponent;
    ((n2.__c = n2.__()), (currentComponent = t3));
  }
  function C2(n2, t3) {
    return (
      !n2 ||
      n2.length !== t3.length ||
      t3.some(function (t4, r3) {
        return t4 !== n2[r3];
      })
    );
  }
  function D2(n2, t3) {
    return 'function' == typeof t3 ? t3(n2) : t3;
  }
  var t2, currentComponent, u2, i2, o2, f2, hooksOptions, e2, a2, v2, l2, m2, s2, k2;
  o2 = 0;
  f2 = [];
  hooksOptions = preactOptions;
  e2 = hooksOptions.__b;
  a2 = hooksOptions.__r;
  v2 = hooksOptions.diffed;
  l2 = hooksOptions.__c;
  m2 = hooksOptions.unmount;
  s2 = hooksOptions.__;
  ((hooksOptions.__b = function (n2) {
    ((currentComponent = null), e2 && e2(n2));
  }),
    (hooksOptions.__ = function (n2, t3) {
      (n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), s2 && s2(n2, t3));
    }),
    (hooksOptions.__r = function (n2) {
      (a2 && a2(n2), (t2 = 0));
      var i3 = (currentComponent = n2.__c).__H;
      (i3 &&
        (u2 === currentComponent
          ? ((i3.__h = []),
            (currentComponent.__h = []),
            i3.__.forEach(function (n3) {
              (n3.__N && (n3.__ = n3.__N), (n3.u = n3.__N = void 0));
            }))
          : (i3.__h.forEach(z2), i3.__h.forEach(B2), (i3.__h = []), (t2 = 0))),
        (u2 = currentComponent));
    }),
    (hooksOptions.diffed = function (n2) {
      v2 && v2(n2);
      var t3 = n2.__c;
      (t3 &&
        t3.__H &&
        (t3.__H.__h.length &&
          ((1 !== f2.push(t3) && i2 === hooksOptions.requestAnimationFrame) ||
            ((i2 = hooksOptions.requestAnimationFrame) || w2)(j2)),
        t3.__H.__.forEach(function (n3) {
          (n3.u && (n3.__H = n3.u), (n3.u = void 0));
        })),
        (u2 = currentComponent = null));
    }),
    (hooksOptions.__c = function (n2, t3) {
      (t3.some(function (n3) {
        try {
          (n3.__h.forEach(z2),
            (n3.__h = n3.__h.filter(function (n4) {
              return !n4.__ || B2(n4);
            })));
        } catch (err) {
          (t3.some(function (n4) {
            n4.__h && (n4.__h = []);
          }),
            (t3 = []),
            hooksOptions.__e(err, n3.__v));
        }
      }),
        l2 && l2(n2, t3));
    }),
    (hooksOptions.unmount = function (n2) {
      m2 && m2(n2);
      var t3,
        r3 = n2.__c;
      r3 &&
        r3.__H &&
        (r3.__H.__.forEach(function (n3) {
          try {
            z2(n3);
          } catch (err) {
            t3 = err;
          }
        }),
        (r3.__H = void 0),
        t3 && hooksOptions.__e(t3, r3.__v));
    }));
  k2 = 'function' == typeof requestAnimationFrame;
  var _Emitter;
  /* ══════════════════════════ 第三方依赖结束 ══════════════════════════ */

  // ─── src/core/Emitter.ts · 事件总线 ───────────────────────────────────
  class Emitter {
    constructor() {
      this.events = new Map();
    }
    on(event, handler) {
      let set = this.events.get(event);
      if (!set) {
        set = new Set();
        this.events.set(event, set);
      }
      set.add(handler);
      return () => this.off(event, handler);
    }
    off(event, handler) {
      const set = this.events.get(event);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.events.delete(event);
      }
    }
    emit(event, ...args) {
      const set = this.events.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        fn(...args);
      }
    }
    once(event, handler) {
      const wrap = (...args) => {
        handler(...args);
        this.off(event, wrap);
      };
      return this.on(event, wrap);
    }
    /**
     * 清空某个事件或全部
     */
    clear(event) {
      if (event) {
        this.events.delete(event);
      } else {
        this.events.clear();
      }
    }
    useEvent(event, getter) {
      const [state, setState] = useState(null);
      useEffect(() => {
        const off = this.on(event, (...args) => {
          setState(getter ? getter(...args) : args[0]);
        });
        return () => off();
      }, []);
      return state;
    }
  }
  var isPlainObject, getPathValue, deepEqual, _Config;
  isPlainObject = (value) => {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  };
  getPathValue = (obj, path) => {
    return path.split('.').reduce((acc, key) => (acc == null ? void 0 : acc[key]), obj);
  };
  deepEqual = (a3, b) => {
    if (a3 === b) return true;
    if (Array.isArray(a3) && Array.isArray(b)) {
      return a3.length === b.length && a3.every((value, index) => deepEqual(value, b[index]));
    }
    if (isPlainObject(a3) && isPlainObject(b)) {
      const keys = [...new Set([...Object.keys(a3), ...Object.keys(b)])];
      return keys.every((key) => deepEqual(a3[key], b[key]));
    }
    return false;
  };
  // ─── src/core/Config.ts · 配置（localStorage 持久化） ─────────────────
  class Config {
    constructor(load = true) {
      this.events = new Emitter();
      this.features = {
        /**
         * 是否开启图片转码
         *
         * @deprecated 已经废弃使用 image_convert_codecs 代替
         */
        convert_webp_to_png: true,
        /**
         * 下载视频分辨率策略
         * 可以选默认，最高清晰度，最小清晰度，和一些其他预设分辨率
         */
        download_video_mode: 'default',
        /**
         * 文件名模板
         */
        filename_template: Config.defaults.filename_template,
        /**
         * 最大文件名长度
         */
        filename_max_length: 64,
        /**
         * 视频下载编码偏好
         *
         * 1. 默认，无偏好 "default"
         * 2. 只下载 h264 "h264"
         * 3. 只下载 h265 "h265"
         * 4. 优先 h264 "h264_prefer"
         * 5. 优先 h265 "h265_prefer"
         */
        video_download_codecs: 'default',
        /**
         * 图片转码编码偏好
         *
         * 仅浏览器下载流程生效；外部下载器不会执行图片转码。
         *
         * 1. 默认，无偏好 "default"
         * 2. 转码为 png "png"
         * 3. 转码为 jpg "jpg"
         * 4. 转码为 webp "webp"
         */
        image_convert_codecs: 'default',
        /**
         * 图片尺寸压缩偏好
         *
         * 仅浏览器下载流程生效；外部下载器不会执行图片压缩。
         *
         * 1. 默认，无偏好 "default"
         * 2. 最大边小于 2k "2k_max"
         * 3. 最大边小于 1k "1k_max"
         * 4. 最大边小于 960 "960_max"
         * 5. 最大边小于 640 "640_max"
         * 5. 最大边小于 512 "512_max"
         */
        image_resize_codecs: 'default',
        /**
         * 图片压缩率 必须开启转码或者尺寸压缩才有用
         *
         * 仅浏览器下载流程生效；外部下载器不会执行图片压缩。
         *
         * 默认 80
         * 推荐 60 以上
         */
        image_quality: 80,
        /**
         * 使用什么下载器 默认为使用浏览器下载，可以配置其他下载
         */
        using_downloader: 'browser',
        /**
         * 下载器配置
         *
         * 不同下载器有不同的配置
         */
        downloader_config: {
          browser: {
            // 没有配置
          },
          idm: {
            id: '1'
          },
          aria2: {
            // 不同类型的下载地址
            dir: {
              video: '`./douyin/${user_dir}/videos`',
              image: '`./douyin/${user_dir}/images`',
              other: '`./douyin/${user_dir}/others`'
            },
            domain: 'http://localhost',
            port: '6800',
            path: '/jsonrpc',
            token: ''
          },
          bc: {
            dir: {
              video: '`./douyin/${user_dir}/videos`',
              image: '`./douyin/${user_dir}/images`',
              other: '`./douyin/${user_dir}/others`'
            },
            domain: 'http://localhost',
            port: '8080',
            path: '/panel/task_add_httpftp_result',
            authName: '',
            authPass: ''
          },
          abdm: {
            // 不同类型的下载地址
            dir: {
              video: '`./douyin/${user_dir}/videos`',
              image: '`./douyin/${user_dir}/images`',
              other: '`./douyin/${user_dir}/others`'
            },
            domain: 'http://localhost',
            port: '15151'
          },
          /**
           * Eagle 推送配置（把作品直接推送到 Eagle 素材库）
           *
           * - folder_id：目标文件夹 id，空字符串表示库根目录
           * - tags：要附加的标签；留空数组表示不添加任何标签
           * - skip_existing：推送前先按「来源页面 URL + 文件名」查询 Eagle，已存在则跳过
           * - send_referer：给抖音 CDN 请求带上 Referer / User-Agent，降低拉取失败率
           * - author_as_tag：把作者昵称追加为标签（推送时生效，不改动 tags 本身）
           * - author_as_folder：在 folder_id（或库根目录）下按作者昵称建/找子文件夹
           */
          eagle: {
            base_url: 'http://127.0.0.1:41595',
            folder_id: '',
            folder_name: '',
            tags: [],
            skip_existing: true,
            send_referer: true,
            author_as_tag: false,
            author_as_folder: false,
            push_history: true,
            push_badge: true,
            push_record_forever: false,
            show_player_button: false
          }
        },
        /**
         * 是否启用下载快捷键
         *
         * 默认开启
         */
        enable_download_shortcut: true,
        /**
         * 下载当前媒体的快捷键
         *
         * 支持 M、Ctrl+M、Alt+M、Shift+M、Ctrl+Shift+M 等组合
         */
        download_shortcut: 'm',
        /**
         * 是否启用「推送到 Eagle」快捷键
         *
         * 默认开启
         */
        enable_eagle_shortcut: true,
        /**
         * 推送到 Eagle 的快捷键
         *
         * 默认 S，支持 M、Ctrl+M、Alt+M、Shift+M、Ctrl+Shift+M 等组合
         */
        eagle_shortcut: 's',
        /**
         * 是否开启作者页面下载器
         *
         * 默认关闭
         */
        enable_profile_downloader: false,
        /**
         * 动图（实况 live photo）取哪种资源
         *
         * 抖音的动图 = 一张静态图 + 一段预览 MP4。
         * - "webp"：取静态图（通常是 webp，分辨率远高于预览 MP4）
         * - "video"：取 live photo 的 MP4（会动，但分辨率较低）
         * - "both"：两者都取
         *
         * 默认 "webp"，与 Eagle 官方扩展取到的画质一致。
         */
        animated_image_mode: 'webp',
        /**
         * 是否优先取原图
         *
         * 抖音图片可能有多个档位：原图（originUrl 一类字段，通常不带 CDN 压缩模板）
         * 与展示图（urlList / downloadUrlList，可能带压缩模板）。
         * 开启后优先用原图地址，取不到时自动回退到展示图。
         *
         * 默认开启。
         */
        prefer_origin_image: true
      };
      this._key = '__douyin-dl-user-js__';
      this._base = this.clone_features();
      this._storage_handler = (event) => {
        if (event.key !== null && event.key !== this._key) return;
        try {
          this.load();
          this.events.emit('config_change');
        } catch (error) {
          console.error(error);
        }
      };
      if (!load) return;
      try {
        this.load();
      } catch (error) {
        console.error(error);
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', this._storage_handler);
      }
    }
    static default_features() {
      return new Config(false).clone_features();
    }
    toJSON() {
      return {
        features: this.features
      };
    }
    static deepMerge(base, patch) {
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        return patch === void 0 ? base : patch;
      }
      const result = Array.isArray(base)
        ? [...base]
        : {
            ...base
          };
      for (const key of Object.keys(patch)) {
        result[key] = this.deepMerge(base?.[key], patch[key]);
      }
      return result;
    }
    static diff_paths(base, next, prefix = '') {
      const result = [];
      const baseKeys = isPlainObject(base) ? Object.keys(base) : [];
      const nextKeys = isPlainObject(next) ? Object.keys(next) : [];
      const keys = [...new Set([...baseKeys, ...nextKeys])];
      for (const key of keys) {
        const path = prefix ? `${prefix}.${key}` : key;
        const oldValue = isPlainObject(base) ? base[key] : void 0;
        const newValue = isPlainObject(next) ? next[key] : void 0;
        if (deepEqual(oldValue, newValue)) continue;
        if (isPlainObject(oldValue) && isPlainObject(newValue)) {
          result.push(...this.diff_paths(oldValue, newValue, path));
        } else {
          result.push(path);
        }
      }
      return result;
    }
    static apply_paths(target, source, paths) {
      const result = JSON.parse(JSON.stringify(target));
      for (const path of paths) {
        const parts = path.split('.');
        let current = result;
        for (let i3 = 0; i3 < parts.length - 1; i3++) {
          if (!isPlainObject(current[parts[i3]])) current[parts[i3]] = {};
          current = current[parts[i3]];
        }
        current[parts[parts.length - 1]] = getPathValue(source, path);
      }
      return result;
    }
    read_stored_features() {
      const raw = localStorage.getItem(this._key);
      if (!raw) return Config.default_features();
      const data = JSON.parse(raw);
      const savedFeatures = data.features || {};
      const features = Config.deepMerge(Config.default_features(), savedFeatures);
      if (
        typeof savedFeatures.download_shortcut === 'string' &&
        !savedFeatures.download_shortcut.trim() &&
        typeof savedFeatures.enable_download_shortcut !== 'boolean'
      ) {
        features.enable_download_shortcut = false;
      }
      return features;
    }
    load() {
      this.features = this.read_stored_features();
      this._base = this.clone_features();
    }
    save() {
      const latest = this.read_stored_features();
      const patch = Config.diff_paths(this._base, this.features);
      this.features = Config.apply_paths(latest, this.features, patch);
      localStorage.setItem(this._key, JSON.stringify(this.toJSON()));
      this._base = this.clone_features();
      this.events.emit('config_change');
    }
    clone_features() {
      return JSON.parse(JSON.stringify(this.features));
    }
  }
  Config.defaults = {
    filename_template: '`${nickname}_${short_id}_${tags}_${desc}`'
  };
  Config.global = new Config();
  // ─── src/utils/format.ts · 文件名模板求值 + 日期格式化 ────────────────
  function runInContext(context, code) {
    const keys = Object.keys(context);
    const head = `const {${keys.join(', ')}} = __CTX__; `;
    let body = code.trim();
    if (!body.startsWith('`')) {
      body = '`' + body.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
    }
    const fn = new Function(
      '__CTX__',
      `${head}
return (${body})`
    );
    return fn(context);
  }
  function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
    const o3 = {
      YYYY: date.getFullYear().toString(),
      MM: ('0' + (date.getMonth() + 1)).slice(-2),
      DD: ('0' + date.getDate()).slice(-2),
      HH: ('0' + date.getHours()).slice(-2),
      mm: ('0' + date.getMinutes()).slice(-2),
      ss: ('0' + date.getSeconds()).slice(-2)
    };
    return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (m3) => o3[m3]);
  }
  // ─── src/utils/string.ts · 文件名 / 路径清洗 ─────────────────────────
  function getReplacementChar(value) {
    if (typeof value !== 'string' || value.length !== 1) return '_';
    if (/[\\/:*?"<>|\x00-\x1f\x7f]/.test(value)) return '_';
    return value;
  }
  function getMaxLength(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_MAX_LENGTH;
    return Math.floor(value);
  }
  function truncateUtf16(value, maxLength) {
    if (value.length <= maxLength) return value;
    let result = '';
    for (const char of value) {
      if (result.length + char.length > maxLength) break;
      result += char;
    }
    return result;
  }
  function escapeRegExp(value) {
    let result = '';
    for (const char of value) {
      if ('\\^$.*+?()[]{}|'.includes(char)) result += '\\';
      result += char;
    }
    return result;
  }
  function cleanSegment(value, options) {
    let clean = value.replace(ILLEGAL_FILENAME_CHARS, options.replacementChar);
    if (options.replaceDots) clean = clean.replace(/\./g, options.replacementChar);
    clean = clean
      .trim()
      .replace(/^\.+/, '')
      .replace(/[.\s]+$/, '');
    if (!clean || clean === '.' || clean === '..') clean = DEFAULT_FALLBACK;
    if (options.allowReserved && RESERVED_NAMES.test(clean)) clean = options.replacementChar + clean;
    clean = clean.replace(new RegExp(`${escapeRegExp(options.replacementChar)}{2,}`, 'g'), options.replacementChar);
    clean = truncateUtf16(clean, options.maxLength);
    if (!clean) clean = truncateUtf16(DEFAULT_FALLBACK, options.maxLength);
    return clean;
  }
  function normalizeOptions(options) {
    return {
      replacementChar: getReplacementChar(options.replacementChar),
      maxLength: getMaxLength(options.maxLength)
    };
  }
  function normalizeFilename(name, options = {}) {
    const {replacementChar, maxLength} = normalizeOptions(options);
    const raw = typeof name === 'string' ? name : '';
    const lastDotIndex = raw.lastIndexOf('.');
    const possibleExt = lastDotIndex > 0 && lastDotIndex < raw.length - 1 ? raw.slice(lastDotIndex + 1) : '';
    const hasExtension = /[^\s.]/.test(possibleExt);
    const rawBase = hasExtension ? raw.slice(0, lastDotIndex) : raw;
    const rawExt = hasExtension ? possibleExt : '';
    const cleanExt = rawExt
      ? cleanSegment(rawExt, {
          replacementChar,
          replaceDots: false,
          allowReserved: false,
          maxLength
        })
      : '';
    const cleanBase = cleanSegment(rawBase, {
      replacementChar,
      replaceDots: false,
      allowReserved: true,
      maxLength: Math.max(1, maxLength - (cleanExt ? cleanExt.length + 1 : 0))
    });
    if (!cleanBase && !cleanExt) return DEFAULT_FALLBACK;
    if (!cleanExt) return cleanBase;
    if (!cleanBase) return '.' + cleanExt;
    return `${cleanBase}.${cleanExt}`;
  }
  function normalizeBasename(name, options = {}) {
    const {replacementChar, maxLength} = normalizeOptions(options);
    const raw = typeof name === 'string' ? name : '';
    return cleanSegment(raw, {
      replacementChar,
      replaceDots: true,
      allowReserved: true,
      maxLength
    });
  }
  function normalizePathSegment(name, options = {}) {
    const {replacementChar, maxLength} = normalizeOptions(options);
    const raw = typeof name === 'string' ? name : '';
    return cleanSegment(raw, {
      replacementChar,
      replaceDots: false,
      allowReserved: true,
      maxLength
    });
  }
  function isProfilePagePath(pathname = location.pathname) {
    const segments = pathname.split('/').filter(Boolean);
    return segments.length === 2 && segments[0] === 'user';
  }
  var ILLEGAL_FILENAME_CHARS, RESERVED_NAMES, DEFAULT_MAX_LENGTH, DEFAULT_FALLBACK;
  ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f\x7f]/g;
  RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?$/i;
  DEFAULT_MAX_LENGTH = 255;
  DEFAULT_FALLBACK = 'file';
  function urlFilenameFallback(url) {
    try {
      const pathname = new URL(url).pathname.split('/').pop();
      return pathname ? decodeURIComponent(pathname) : 'download';
    } catch {
      return 'download';
    }
  }
  var _DownloaderLauncher;
  // ─── src/core/download/DownloaderLauncher.ts · 拉起外部下载器 ────────
  class DownloaderLauncher {
    constructor(config = {}) {
      this._idmSeq = 1;
      this.config = {
        idmList: config.idmList || [
          {
            id: '1'
          }
        ],
        aria2List: config.aria2List || [
          {
            domain: 'http://localhost',
            port: '6800',
            path: '/jsonrpc',
            token: '',
            dir: ''
          }
        ],
        bitcometList: config.bitcometList || [
          {
            domain: 'http://localhost',
            port: '8080',
            path: '/panel/task_add_httpftp_result',
            authName: '',
            authPass: '',
            dir: ''
          }
        ],
        abdmList: config.abdmList || [
          {
            domain: 'http://localhost',
            port: '15151',
            dir: ''
          }
        ],
        curlTerminal: config.curlTerminal || 'wc'
      };
    }
    // ==================== Dir Template ====================
    /**
     * 简化入口：解析下载目录模板
     */
    _resolveDirTemplate(input, context, fallback = '') {
      if (typeof input !== 'string' || !input.trim()) return fallback;
      try {
        const resolved = runInContext(context, input);
        return typeof resolved === 'string' && resolved.trim() ? resolved : fallback;
      } catch {
        return fallback;
      }
    }
    // ==================== invoke_download ====================
    /**
     * 简化入口：调用下载器下载
     */
    async invoke_download(url, dl_name = 'abdm', dir_config, options = {}) {
      const input_filename = options.filename_input || urlFilenameFallback(url);
      const media = options.media;
      const filename = normalizeFilename(input_filename);
      const isVideo = filename.endsWith('.mp4') || filename.endsWith('.webm') || filename.endsWith('.ts');
      const isImage =
        filename.endsWith('.jpg') ||
        filename.endsWith('.jpeg') ||
        filename.endsWith('.png') ||
        filename.endsWith('.webp');
      const authorInfo = media?.authorInfo || {};
      const userId = authorInfo.uid || media?.authorUserId || authorInfo.secUid || 'unknown';
      const nickname = authorInfo.nickname || 'unknown';
      const safeUserDir = normalizePathSegment(`${userId}_${nickname}`);
      const filename_base = normalizeBasename(filename.replace(/\.[^/.]+$/, ''));
      const mediaType = options.mediaType || (isVideo ? 'video' : isImage ? 'image' : 'other');
      const defaultDir =
        mediaType === 'video'
          ? `./douyin/${safeUserDir}/videos`
          : mediaType === 'image'
            ? `./douyin/${safeUserDir}/images`
            : `./douyin/${safeUserDir}/others`;
      const dirContext = {
        media,
        filename,
        filename_base,
        user_dir: safeUserDir,
        author_info: authorInfo,
        uid: userId,
        nickname,
        aweme_id: media?.awemeId || '',
        desc: media?.desc || ''
      };
      const resolvedDir = this._resolveDirTemplate(dir_config?.[mediaType], dirContext, defaultDir);
      switch (dl_name) {
        case 'idm':
          return this.launchIDM(url, filename, 0, {}, null);
        case 'aria2':
          return this.launchAria2(
            url,
            filename,
            {},
            {
              dir: resolvedDir
            }
          );
        case 'bc':
          return this.launchBitComet(
            url,
            filename,
            {},
            {
              dir: resolvedDir
            }
          );
        case 'abdm':
          return this.launchABDM(
            url,
            filename,
            {},
            {
              dir: resolvedDir
            }
          );
        default:
          throw new Error(`Unknown download name: ${dl_name}`);
      }
    }
    // ==================== Config helpers ====================
    /**
     * 获取默认配置项
     */
    getDefaultConfig(type) {
      const listMap = {
        idm: this.config.idmList,
        aria2: this.config.aria2List,
        bitcomet: this.config.bitcometList,
        abdm: this.config.abdmList
      };
      const list = listMap[type];
      if (!list) throw new Error(`Unknown type: ${type}`);
      return list.find((item) => item.default) || list[0];
    }
    // ==================== Static utilities ====================
    /**
     * 标准化请求头：转换为对象，添加常用默认头
     */
    static normalizeHeaders(headers = {}, addDefault = false) {
      if (typeof headers === 'string') {
        const raw = {};
        headers.split(/[\r\n]+/).forEach((line) => {
          if (!line.trim() || !line.includes(':')) return;
          const [key, ...parts] = line.split(':');
          raw[key.trim().toLowerCase()] = parts.join(':').trim();
        });
        headers = raw;
      }
      const newHeaders = {};
      for (const key in headers) {
        let value = headers[key];
        if (typeof value === 'object') value = JSON.stringify(value);
        else value = String(value);
        const normalizedKey = key
          .toLowerCase()
          .split('-')
          .map((w3) => w3.charAt(0).toUpperCase() + w3.slice(1))
          .join('-');
        newHeaders[normalizedKey] = value;
      }
      if (addDefault) return newHeaders;
      return {
        Dnt: '',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Expires: '0',
        Cookie: document.cookie,
        'User-Agent': navigator.userAgent,
        Origin: location.origin,
        Referer: `${location.origin}/`,
        ...newHeaders
      };
    }
    /**
     * 可跨域 xmlhttpRequest 请求
     * 封装 GreaseMonkey-Compatible xmlhttpRequest 实现的跨域请求，支持回调和 await 两种用法
     */
    static xmlHttpRequest(option) {
      const xhr =
        typeof GM_xmlhttpRequest === 'function'
          ? GM_xmlhttpRequest
          : typeof GM?.xmlHttpRequest === 'function'
            ? GM.xmlHttpRequest
            : null;
      if (!xhr || typeof xhr !== 'function') throw new Error('GreaseMonkey 兼容 XMLHttpRequest 不可用。');
      return xhr({
        withCredentials: true,
        ...option
      });
    }
    /**
     * 发送HTTP请求，使用 gm-xmlhttpRequest 发起跨域请求
     */
    static request_cors(url, options = {}) {
      return new Promise((resolve, reject) => {
        const {method = 'GET', headers = {}, body, timeout = 3e4, responseType} = options;
        DownloaderLauncher.xmlHttpRequest({
          method,
          url,
          headers,
          data: body,
          timeout,
          responseType,
          onload: (res) => {
            let data = res.response;
            if (!responseType) {
              const ct = res.responseHeaders || '';
              if (ct.includes('application/json')) {
                try {
                  data = JSON.parse(res.responseText);
                } catch {
                  data = res.responseText;
                }
              } else data = res.responseText;
            }
            resolve({
              status: res.status,
              data,
              headers: res.responseHeaders
            });
          },
          onerror: (err) => reject(err),
          ontimeout: () => reject(new Error('Request timeout'))
        });
      });
    }
    /**
     * 发送HTTP请求，默认用这个请求，不需要权限
     */
    static async request(url, options = {}) {
      const response = await fetch(url, options);
      let data;
      const ct = response.headers.get('content-type');
      if (ct && ct.includes('application/json')) data = await response.json();
      else data = await response.text();
      return {
        status: response.status,
        data
      };
    }
    /**
     * 格式化文件大小（用于调试）
     */
    static formatSize(bytes) {
      if (bytes === 0) return '0 B';
      const k3 = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i3 = Math.floor(Math.log(bytes) / Math.log(k3));
      return parseFloat((bytes / Math.pow(k3, i3)).toFixed(2)) + ' ' + sizes[i3];
    }
    static commandSafeFilename(filename) {
      return normalizeFilename(filename).replace(/[!&|`"'$%]/g, '_');
    }
    /**
     * 生成cURL命令
     */
    static toCurlCommand(link, filename, headers = {}, terminal = 'wc') {
      const curlCmd = terminal !== 'wp' ? 'curl' : 'curl.exe';
      const headerArgs = Object.entries(headers)
        .map(([k3, v3]) => `-H "${k3}: ${v3}"`)
        .join(' ');
      const safeFilename = DownloaderLauncher.commandSafeFilename(filename);
      return `${curlCmd} -L -C - "${link}" -o "${safeFilename}" ${headerArgs}`.trim();
    }
    /**
     * 生成BC链接（比特彗星专用）
     */
    static toBitCometLink(link, filename, headers = {}) {
      const safeFilename = DownloaderLauncher.commandSafeFilename(filename);
      const query = new URLSearchParams();
      query.append('url', link);
      for (const [k3, v3] of Object.entries(headers)) query.append(k3, v3);
      const bcData = `AA/${encodeURIComponent(safeFilename)}/?${query.toString()}ZZ`;
      const base64Data = btoa(unescape(encodeURIComponent(bcData)));
      return `bc://http/${base64Data}`;
    }
    // ==================== Launchers ====================
    /**
     * 发送到 IDM
     */
    async launchIDM(link, filename, filesize, headers = {}, idmConfig = null) {
      filename = normalizeFilename(filename);
      const config = {
        ...this.getDefaultConfig('idm'),
        ...idmConfig
      };
      const clientId = config.id || '1';
      if (!clientId) throw new Error('IDM client id missing');
      const seq = ++this._idmSeq;
      const time = Date.now();
      const url = `http://127.0.0.1:1001/client/${clientId}?seq=${seq}`;
      const ext = filename.split('.').pop()?.toUpperCase() || '';
      const normHeaders = DownloaderLauncher.normalizeHeaders(headers);
      const headersText =
        Object.entries(normHeaders)
          .map(([k3, v3]) => `${k3}: ${v3}`)
          .join('\n') + '\n';
      const fmt2 = (key, val) => {
        const s5 = String(val ?? '');
        return `${key}=${new Blob([s5]).size}:${s5}`;
      };
      const fields = [
        fmt2(4, ext),
        fmt2(6, link),
        fmt2(7, location.origin),
        fmt2(11, headersText),
        fmt2(100, filename),
        fmt2(122, 4)
      ];
      const data = `MSG#${seq}#13#1#10241:${seq + 1e3}:0:${time}:0:1:2:${filesize}:0,${fields.join(',')};`;
      try {
        const res = await DownloaderLauncher.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain'
          },
          body: data
        });
        return res.data === `${seq}:3;`;
      } catch (err) {
        console.error('IDM launch failed', err);
        return false;
      }
    }
    /**
     * 发送到 Aria2
     */
    async launchAria2(link, filename, headers = {}, aria2Config = null) {
      filename = normalizeFilename(filename);
      const config = {
        ...this.getDefaultConfig('aria2'),
        ...aria2Config
      };
      const url = `${config.domain}:${config.port}${config.path}`;
      const headerList = Object.entries(DownloaderLauncher.normalizeHeaders(headers)).map(([k3, v3]) => `${k3}: ${v3}`);
      const params = [
        `token:${config.token}`,
        [link],
        {
          dir: config.dir || void 0,
          out: filename,
          header: headerList
        }
      ];
      const rpcData = {
        id: Date.now(),
        jsonrpc: '2.0',
        method: 'aria2.addUri',
        params
      };
      try {
        const res = await DownloaderLauncher.request_cors(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(rpcData)
        });
        return !!res.data?.result;
      } catch (err) {
        console.error('Aria2 launch failed', err);
        return false;
      }
    }
    /**
     * 发送到比特彗星 (BitComet)
     */
    async launchBitComet(link, filename, headers = {}, bitcometConfig = null) {
      filename = normalizeFilename(filename);
      const config = {
        ...this.getDefaultConfig('bitcomet'),
        ...bitcometConfig
      };
      const url = `${config.domain}:${config.port}${config.path}`;
      const formData = new URLSearchParams();
      formData.append('url', link);
      if (config.dir) formData.append('save_path', config.dir);
      formData.append('file_name', filename);
      formData.append('connection', '200');
      const normHeaders = DownloaderLauncher.normalizeHeaders(headers);
      for (const [k3, v3] of Object.entries(normHeaders)) formData.append(k3, v3);
      const auth = btoa(`${config.authName}:${config.authPass}`);
      try {
        const res = await DownloaderLauncher.request(url, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData
        });
        return !res.data.includes('Add task failed!');
      } catch (err) {
        console.warn('BitComet launch may have succeeded despite error', err);
        return true;
      }
    }
    /**
     * 发送到 AB Download Manager
     */
    async launchABDM(link, filename, headers = {}, abdmConfig = null) {
      filename = normalizeFilename(filename);
      const config = {
        ...this.getDefaultConfig('abdm'),
        ...abdmConfig
      };
      const url = `${config.domain}:${config.port}/start-headless-download`;
      const normHeaders = DownloaderLauncher.normalizeHeaders(headers);
      const payload = {
        downloadSource: {
          link,
          headers: normHeaders,
          downloadPage: normHeaders['Referer'] || location.href
        },
        name: filename
      };
      if (config.dir) payload.folder = config.dir;
      try {
        const res = await DownloaderLauncher.request_cors(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=UTF-8'
          },
          body: JSON.stringify(payload)
        });
        return res.data === 'OK';
      } catch (err) {
        console.error('ABDM launch failed', err);
        return false;
      }
    }
    // ==================== 以下是同步命令生成方法（不实际唤醒）====================
    getCurlCommand(link, filename, headers = {}) {
      return DownloaderLauncher.toCurlCommand(link, filename, headers, this.config.curlTerminal);
    }
    getBitCometLink(link, filename, headers = {}) {
      return DownloaderLauncher.toBitCometLink(link, filename, headers);
    }
    getAria2Command(link, filename, headers = {}) {
      const headerArgs = Object.entries(headers)
        .map(([k3, v3]) => `--header "${k3}: ${v3}"`)
        .join(' ');
      const safeFilename = DownloaderLauncher.commandSafeFilename(filename);
      return `aria2c "${link}" --out "${safeFilename}" ${headerArgs}`.trim();
    }
  }
  // ─── src/utils/storage.ts · localStorage 安全读写 ────────────────────
  function trySetLocalStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  var _DownloadHistory;
  // ─── src/core/download/DownloadHistory.ts · 下载记录 ─────────────────
  class DownloadHistory {
    // 最多保存50条记录
    static get() {
      try {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : [];
      } catch {
        return [];
      }
    }
    static add(media, downloadTime = Date.now()) {
      const history = this.get();
      const record = {
        id: media.awemeId || `hist_${Date.now()}_${Math.random()}`,
        desc: media.desc || '(无描述)',
        shareUrl: media.shareInfo?.shareUrl || '',
        downloadTime,
        media: {
          // 只保存必要字段，避免存储过大
          awemeId: media.awemeId,
          desc: media.desc,
          shareUrl: media.shareInfo?.shareUrl,
          authorNickname: media.authorInfo?.nickname
          // 可额外保存封面等，但注意localStorage容量限制
        }
      };
      history.unshift(record);
      if (history.length > this.MAX_ITEMS) history.pop();
      trySetLocalStorage(this.STORAGE_KEY, JSON.stringify(history));
      return record;
    }
    static clear() {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }
  DownloadHistory.STORAGE_KEY = '__douyin-dl-history__';
  DownloadHistory.MAX_ITEMS = 50;
  // ─── src/handlers/douyin/getBestCoverUrl.ts · 取最佳封面 ─────────────
  function isRootCoverContainer(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const candidate = obj;
    return !!(
      typeof candidate.cover === 'string' ||
      Array.isArray(candidate.coverUrlList) ||
      Array.isArray(candidate.originCoverUrlList) ||
      typeof candidate.dynamicCover === 'string' ||
      typeof candidate.rawCover === 'string'
    );
  }
  function extractFromContainer(container) {
    if (!container) return null;
    if (container.dynamicCover && container.dynamicCover.includes('_large')) {
      return container.dynamicCover;
    }
    if (container.rawCover) {
      return container.rawCover;
    }
    const candidates = [...(container.originCoverUrlList || []), ...(container.coverUrlList || [])];
    const cleanCandidates = candidates.filter(
      (url) =>
        typeof url === 'string' &&
        !url.includes('cropcenter') &&
        !url.includes('sh=') &&
        !url.includes('360p') &&
        !url.includes('720p')
    );
    if (cleanCandidates.length > 0) {
      return cleanCandidates[0];
    }
    return container.originCover || container.cover || null;
  }
  function getBestCoverUrl(media) {
    if (media.video) {
      const fromVideo = extractFromContainer(media.video);
      if (fromVideo) return fromVideo;
    }
    if (isRootCoverContainer(media)) {
      const fromRoot = extractFromContainer(media);
      if (fromRoot) return fromRoot;
    }
    return null;
  }
  /* ══════════════════════ 第三方依赖：preact/jsx-runtime ══════════════
   * jsx() 是 jsx-runtime 的运行时（等价于 h），原样内联，勿手改。
   * ══════════════════════════════════════════════════════════════════ */
  function jsx(e3, t3, n2, o3, i3, u4) {
    t3 || (t3 = {});
    var a3,
      c4,
      p3 = t3;
    if ('ref' in p3) for (c4 in ((p3 = {}), t3)) 'ref' == c4 ? (a3 = t3[c4]) : (p3[c4] = t3[c4]);
    var l3 = {
      type: e3,
      props: p3,
      key: n2,
      ref: a3,
      __k: null,
      __: null,
      __b: 0,
      __e: null,
      __c: null,
      constructor: void 0,
      __v: --f3,
      __i: -1,
      __u: 0,
      __source: i3,
      __self: u4
    };
    if ('function' == typeof e3 && (a3 = e3.defaultProps)) for (c4 in a3) void 0 === p3[c4] && (p3[c4] = a3[c4]);
    return (preactOptions.vnode && preactOptions.vnode(l3), l3);
  }
  var f3;
  f3 = 0;
  // ─── src/utils/css-in-js.ts · 原子 CSS 类名生成 ──────────────────────
  function createCSS() {
    const style = document.createElement('style');
    document.head.appendChild(style);
    const sheet = style.sheet;
    const cache = new Map();
    const kebab = (s5) => s5.replace(/[A-Z]/g, (m3) => '-' + m3.toLowerCase());
    const hash = (s5) => {
      let h3 = 0,
        i3 = s5.length;
      while (i3) h3 = (h3 * 31 + s5.charCodeAt(--i3)) | 0;
      return 'c' + (h3 >>> 0).toString(36);
    };
    const merge = (input) =>
      Array.isArray(input)
        ? input.filter(Boolean).reduce((a3, b) => {
            return Object.assign(a3, merge(b));
          }, {})
        : input || {};
    function build(selector, obj) {
      let body = '';
      for (const k3 in obj) {
        const v3 = obj[k3];
        if (v3 == null || v3 === false) continue;
        if (typeof v3 === 'object') {
          const sel = k3.includes('&') ? k3.replace(/&/g, selector) : `${selector} ${k3}`;
          build(sel, v3);
        } else {
          body += `${kebab(k3)}:${v3};`;
        }
      }
      if (body) {
        sheet.insertRule(`${selector}{${body}}`, sheet.cssRules.length);
      }
    }
    build;
    return function css4(input) {
      const obj = merge(input);
      const key = JSON.stringify(obj);
      if (cache.has(key)) return cache.get(key);
      const className = hash(key);
      build(`.${className}`, obj);
      cache.set(key, className);
      return className;
    };
  }
  // ─── src/utils/theme.ts · 设计变量 ──────────────────────────────────
  var theme;
  theme = {
    colors: {
      primary: '#fe2c55',
      primaryLight: '#ff8a80',
      bgOverlay: 'rgba(18, 18, 20, 0.94)',
      bgNav: 'rgba(0,0,0,0.2)',
      bgFieldset: 'rgba(0,0,0,0.2)',
      borderLight: 'rgba(255,255,255,0.1)',
      borderMedium: 'rgba(255,255,255,0.15)',
      borderInput: 'rgba(255,255,255,0.2)',
      textPrimary: '#fff',
      textSecondary: 'rgba(255,255,255,0.8)',
      textMuted: 'rgba(255,255,255,0.6)',
      textDim: '#999'
    },
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '12px',
      lg: '16px',
      xl: '20px'
    },
    borderRadius: {
      sm: '8px',
      md: '12px',
      lg: '16px',
      full: '20px'
    },
    fontSize: {
      xs: '12px',
      sm: '13px'
    },
    backdropBlur: 'blur(10px)'
  };
  // ─── src/ui/modals/MediaDetailModal.tsx · 媒体详情弹窗 ──────────────
  var css,
    styles,
    navBtnClass,
    formatters,
    msToAssTime,
    KeyValue,
    Copyable,
    Table,
    launchers,
    LaunchButtons,
    VideoSection,
    ImageSection,
    MusicSection,
    MediaTab,
    AuthorTab,
    PostTab,
    JsonTab,
    DanmakuTab,
    tabs,
    MediaDetailModalApp;
  css = createCSS();
  styles = {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      height: '80vh',
      overflow: 'hidden',
      background: theme.colors.bgOverlay,
      backdropFilter: theme.backdropBlur,
      borderRadius: theme.borderRadius.lg,
      color: theme.colors.textPrimary
    }),
    nav: css({
      display: 'flex',
      borderBottom: '1px solid ' + theme.colors.borderLight,
      background: theme.colors.bgNav,
      flexShrink: 0
    }),
    navBtnBase: css({
      padding: theme.spacing.md + ' ' + theme.spacing.xl,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      borderBottom: '2px solid transparent',
      fontWeight: 'normal',
      color: theme.colors.textSecondary,
      transition: '0.2s'
    }),
    navBtnActive: css({
      background: 'rgba(255,255,255,0.08)',
      borderBottomColor: theme.colors.primary,
      fontWeight: 'bold',
      color: theme.colors.primary
    }),
    content: css({
      flexGrow: 1,
      overflowY: 'auto',
      padding: theme.spacing.xl
    }),
    fieldset: css({
      border: '1px solid ' + theme.colors.borderMedium,
      borderRadius: theme.borderRadius.md,
      marginBottom: theme.spacing.xl,
      padding: theme.spacing.lg,
      background: theme.colors.bgFieldset
    }),
    legend: css({
      fontWeight: 'bold',
      padding: '0 ' + theme.spacing.sm,
      color: 'rgba(255,255,255,0.9)',
      background: 'rgba(18,18,20,0.8)',
      borderRadius: theme.borderRadius.full,
      fontSize: theme.fontSize.sm
    }),
    row: css({
      display: 'flex',
      padding: theme.spacing.sm + ' 0',
      fontSize: theme.fontSize.sm,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      alignItems: 'center'
    }),
    label: css({
      width: '100px',
      flexShrink: 0,
      color: theme.colors.textMuted,
      fontWeight: 600
    }),
    value: css({
      flexGrow: 1,
      color: theme.colors.textSecondary,
      wordBreak: 'break-all'
    }),
    btn: css({
      padding: theme.spacing.xs + ' ' + theme.spacing.md,
      fontSize: theme.fontSize.xs,
      cursor: 'pointer',
      border: '1px solid rgba(255,255,255,0.3)',
      background: 'rgba(255,255,255,0.08)',
      color: theme.colors.textPrimary,
      borderRadius: theme.borderRadius.full,
      marginLeft: theme.spacing.sm,
      transition: '0.2s'
    }),
    img: css({
      maxWidth: '100px',
      maxHeight: '80px',
      objectFit: 'cover',
      borderRadius: theme.borderRadius.sm,
      border: '1px solid ' + theme.colors.borderInput
    }),
    table: css({
      width: '100%',
      fontSize: theme.fontSize.xs,
      borderCollapse: 'collapse',
      background: 'rgba(0,0,0,0.2)',
      borderRadius: theme.borderRadius.sm,
      overflow: 'hidden'
    }),
    th: css({
      border: '1px solid ' + theme.colors.borderLight,
      padding: theme.spacing.sm,
      background: 'rgba(0,0,0,0.4)',
      textAlign: 'left',
      color: 'rgba(255,255,255,0.9)'
    }),
    td: css({
      border: '1px solid ' + theme.colors.borderLight,
      padding: theme.spacing.sm,
      color: theme.colors.textSecondary
    }),
    flexRow: css({
      display: 'flex',
      gap: '15px',
      alignItems: 'center'
    }),
    flexWrap: css({
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap'
    }),
    imgCover: css({
      width: '120px',
      borderRadius: '4px'
    }),
    authorHeader: css({
      display: 'flex',
      gap: '15px',
      marginBottom: '20px',
      alignItems: 'center'
    }),
    jsonPre: css({
      background: 'rgba(0,0,0,0.3)',
      padding: '10px',
      overflow: 'auto',
      maxHeight: '100%',
      fontSize: '12px',
      wordBreak: 'break-all',
      whiteSpace: 'pre-wrap',
      border: '1px solid ' + theme.colors.borderInput,
      borderRadius: theme.borderRadius.sm,
      cursor: 'text',
      color: '#ddd'
    }),
    danmakuContainer: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing.md
    }),
    danmakuHeader: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }),
    danmakuTitle: css({
      margin: 0
    }),
    danmakuButtonGroup: css({
      display: 'flex',
      gap: theme.spacing.sm
    }),
    danmakuEmpty: css({
      textAlign: 'center',
      padding: theme.spacing.xl,
      color: theme.colors.textDim
    }),
    danmakuTableWrapper: css({
      maxHeight: '500px',
      overflowY: 'auto',
      border: '1px solid #ddd',
      borderRadius: '4px'
    })
  };
  navBtnClass = (active) => (active ? styles.navBtnBase + ' ' + styles.navBtnActive : styles.navBtnBase);
  formatters = {
    ts: (ts) => (ts ? new Date(ts * 1e3).toLocaleString() : 'N/A'),
    num: (n2) => (n2 ? (n2 > 1e4 ? (n2 / 1e4).toFixed(1) + ' 万' : n2) : 0),
    size: (s5) => (s5 ? (s5 / 1024 / 1024).toFixed(2) + ' MB' : '-')
  };
  msToAssTime = (ms) => {
    const h3 = Math.floor(ms / 36e5);
    const m3 = Math.floor((ms % 36e5) / 6e4);
    const s5 = Math.floor((ms % 6e4) / 1e3);
    const cs = Math.floor((ms % 1e3) / 10);
    return (
      h3.toString().padStart(2, '0') +
      ':' +
      m3.toString().padStart(2, '0') +
      ':' +
      s5.toString().padStart(2, '0') +
      '.' +
      cs.toString().padStart(2, '0')
    );
  };
  KeyValue = ({label, children}) =>
    jsx('div', {
      className: styles.row,
      children: [
        jsx('strong', {
          className: styles.label,
          children: label
        }),
        jsx('span', {
          className: styles.value,
          children: children ?? '-'
        })
      ]
    });
  Copyable = ({label, value}) => {
    const [c4, sc] = useState(false);
    const h3 = () => {
      navigator.clipboard.writeText(value || '').then(() => {
        sc(true);
        setTimeout(() => sc(false), 2e3);
      });
    };
    if (!value)
      return jsx(KeyValue, {
        label
      });
    return jsx('div', {
      className: styles.row,
      children: [
        jsx('strong', {
          className: styles.label,
          children: label
        }),
        jsx('span', {
          className: styles.value,
          children: value
        }),
        jsx('button', {
          className: styles.btn,
          onClick: h3,
          children: c4 ? '已复制' : '复制'
        })
      ]
    });
  };
  Table = ({headers, rows}) =>
    jsx('table', {
      className: styles.table,
      children: [
        jsx('thead', {
          children: jsx('tr', {
            children: headers.map((h3, i3) =>
              jsx(
                'th',
                {
                  className: styles.th,
                  children: h3
                },
                i3
              )
            )
          })
        }),
        jsx('tbody', {
          children: rows.map((row, i3) =>
            jsx(
              'tr',
              {
                children: row.map((cell, j3) =>
                  jsx(
                    'td',
                    {
                      className: styles.td,
                      children: cell
                    },
                    j3
                  )
                )
              },
              i3
            )
          )
        })
      ]
    });
  launchers = [
    {
      key: 'browser',
      label: '打开',
      buildUrl: (u4) => u4
    },
    {
      key: 'copy',
      label: '复制',
      buildUrl: () => null,
      action: (u4) => {
        navigator.clipboard.writeText(u4);
        alert('复制成功');
      }
    },
    {
      key: 'potplayer',
      label: 'PotPlayer',
      buildUrl: (u4) => 'potplayer://' + u4
    },
    {
      key: 'abdm',
      label: 'abdm',
      buildUrl: () => null,
      action: async (u4) => {
        const l3 = new DownloaderLauncher();
        await l3.invoke_download(u4, 'abdm');
      }
    },
    {
      key: 'aria2',
      label: 'aria2',
      buildUrl: () => null,
      action: async (u4) => {
        const l3 = new DownloaderLauncher();
        await l3.invoke_download(u4, 'aria2');
      }
    }
  ];
  LaunchButtons = ({url}) =>
    jsx('div', {
      className: styles.flexWrap,
      children: launchers.map((l3) => {
        const h3 = l3.buildUrl?.(url);
        if (l3.action)
          return jsx(
            'button',
            {
              className: styles.btn,
              onClick: () => l3.action(url),
              children: l3.label
            },
            l3.key
          );
        if (h3)
          return jsx(
            'a',
            {
              href: h3,
              target: '_blank',
              children: jsx('button', {
                className: styles.btn,
                children: l3.label
              })
            },
            l3.key
          );
        return null;
      })
    });
  VideoSection = ({video, media, filenameBase}) => {
    if (!video?.bitRateList?.length) return null;
    const cu = getBestCoverUrl(media) || '#';
    return jsx(Fragment, {
      children: [
        jsx('fieldset', {
          className: styles.fieldset,
          children: [
            jsx('legend', {
              className: styles.legend,
              children: '视频封面'
            }),
            jsx('div', {
              className: styles.flexRow,
              children: [
                jsx('img', {
                  src: cu,
                  className: styles.imgCover
                }),
                jsx('div', {
                  children: [
                    jsx('p', {
                      children: [
                        jsx('strong', {
                          children: '分辨率:'
                        }),
                        ' ',
                        video.width,
                        'x',
                        video.height
                      ]
                    }),
                    jsx('div', {
                      style: {
                        marginTop: 10
                      },
                      children: [
                        jsx('a', {
                          href: cu,
                          target: '_blank',
                          className: styles.btn,
                          children: '新标签打开'
                        }),
                        jsx('a', {
                          href: cu,
                          download: normalizeFilename('cover_' + filenameBase + '.jpeg'),
                          className: styles.btn,
                          children: '下载封面'
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        jsx('fieldset', {
          className: styles.fieldset,
          children: [
            jsx('legend', {
              className: styles.legend,
              children: '视频源'
            }),
            jsx(Table, {
              headers: ['清晰度', '分辨率', '编码', 'FPS', '码率', '大小', '操作'],
              rows: video.bitRateList.map((v3) => [
                v3.gearName,
                v3.width + 'x' + v3.height,
                (v3.isH265 ? 'H.265' : 'H.264') + (v3.format === 'dash' ? ' dash' : ''),
                v3.fps,
                (v3.bitRate / 1e3).toFixed(0),
                formatters.size(v3.dataSize),
                v3.playApi
                  ? jsx(LaunchButtons, {
                      url: v3.playApi
                    })
                  : '-'
              ])
            })
          ]
        })
      ]
    });
  };
  ImageSection = ({images}) => {
    if (!images?.length) return null;
    return jsx('fieldset', {
      className: styles.fieldset,
      children: [
        jsx('legend', {
          className: styles.legend,
          children: ['图集 (', images.length, 'P)']
        }),
        jsx(Table, {
          headers: ['#', '类型', '预览', '分辨率', '大小', '下载'],
          rows: images.map((img, i3) => {
            const iv = !!img.video;
            const th = iv ? img.video.originCoverUrlList?.[0] : img.urlList?.[0];
            const dl = iv ? img.video.playAddr?.[0]?.src : img.urlList?.[0];
            return [
              i3 + 1,
              iv ? '视频' : '图片',
              jsx('img', {
                src: th,
                className: styles.img,
                loading: 'lazy'
              }),
              iv ? img.video.width + 'x' + img.video.height : img.width + 'x' + img.height,
              iv ? formatters.size(img.video.dataSize) : '-',
              dl
                ? jsx('a', {
                    href: dl,
                    target: '_blank',
                    children: '链接'
                  })
                : '-'
            ];
          })
        })
      ]
    });
  };
  MusicSection = ({music}) => {
    if (!music) return null;
    const du = music.playUrl?.urlList?.[0] || '';
    return jsx('fieldset', {
      className: styles.fieldset,
      children: [
        jsx('legend', {
          className: styles.legend,
          children: '背景音乐'
        }),
        jsx('div', {
          className: styles.flexRow,
          children: [
            jsx('img', {
              src: music.coverThumb?.urlList?.[0],
              style: {
                width: 60,
                height: 60,
                borderRadius: 4
              },
              loading: 'lazy'
            }),
            jsx('div', {
              style: {
                flex: 1
              },
              children: [
                jsx(KeyValue, {
                  label: '标题',
                  children: music.title
                }),
                jsx(KeyValue, {
                  label: '作者',
                  children: music.author
                }),
                jsx(KeyValue, {
                  label: '时长',
                  children: [music.duration, '秒']
                }),
                du &&
                  jsx('a', {
                    href: du,
                    target: '_blank',
                    className: styles.btn,
                    children: '下载'
                  }),
                du &&
                  jsx('audio', {
                    controls: true,
                    preload: 'metadata',
                    style: {
                      width: '100%'
                    },
                    children: jsx('source', {
                      src: du
                    })
                  })
              ]
            })
          ]
        })
      ]
    });
  };
  MediaTab = ({media, filenameBase}) => {
    if (!media)
      return jsx('div', {
        children: '无媒体信息'
      });
    return jsx('div', {
      children: [
        jsx(VideoSection, {
          media,
          video: media.video,
          filenameBase
        }),
        jsx(ImageSection, {
          images: media.images
        }),
        jsx(MusicSection, {
          music: media.music
        })
      ]
    });
  };
  AuthorTab = ({author}) => {
    if (!author)
      return jsx('div', {
        children: '无作者信息'
      });
    return jsx(Fragment, {
      children: [
        jsx('div', {
          className: styles.authorHeader,
          children: [
            jsx('img', {
              src: author.avatarThumb?.urlList?.[0],
              style: {
                width: 80,
                height: 80,
                borderRadius: '50%'
              }
            }),
            jsx('div', {
              children: [
                jsx('h3', {
                  children: author.nickname
                }),
                jsx('a', {
                  href: 'https://www.douyin.com/user/' + author.secUid,
                  target: '_blank',
                  className: styles.btn,
                  children: '访问主页'
                })
              ]
            })
          ]
        }),
        jsx(KeyValue, {
          label: '认证',
          children: author.customVerify || author.enterpriseVerifyReason
        }),
        jsx(Copyable, {
          label: 'UID',
          value: author.uid
        }),
        jsx(Copyable, {
          label: 'SecUID',
          value: author.secUid
        }),
        jsx(KeyValue, {
          label: '粉丝数',
          children: formatters.num(author.followerCount)
        }),
        jsx(KeyValue, {
          label: '获赞数',
          children: formatters.num(author.totalFavorited)
        })
      ]
    });
  };
  PostTab = ({media}) =>
    jsx(Fragment, {
      children: [
        jsx('fieldset', {
          className: styles.fieldset,
          children: [
            jsx('legend', {
              className: styles.legend,
              children: '描述'
            }),
            jsx('div', {
              style: {
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5
              },
              children: media.desc || '无描述'
            })
          ]
        }),
        jsx('fieldset', {
          className: styles.fieldset,
          children: [
            jsx('legend', {
              className: styles.legend,
              children: '数据统计'
            }),
            jsx(KeyValue, {
              label: '发布时间',
              children: formatters.ts(media.createTime)
            }),
            jsx(Copyable, {
              label: '分享链接',
              value: media.shareInfo?.shareUrl
            }),
            jsx(KeyValue, {
              label: '点赞',
              children: formatters.num(media.stats?.diggCount)
            }),
            jsx(KeyValue, {
              label: '评论',
              children: formatters.num(media.stats?.commentCount)
            }),
            jsx(KeyValue, {
              label: '收藏',
              children: formatters.num(media.stats?.collectCount)
            }),
            jsx(KeyValue, {
              label: '分享',
              children: formatters.num(media.stats?.shareCount)
            })
          ]
        }),
        jsx('fieldset', {
          className: styles.fieldset,
          children: [
            jsx('legend', {
              className: styles.legend,
              children: 'ID信息'
            }),
            jsx(Copyable, {
              label: 'Aweme ID',
              value: media.awemeId
            }),
            jsx(Copyable, {
              label: 'Group ID',
              value: media.groupId
            })
          ]
        }),
        jsx('fieldset', {
          className: styles.fieldset,
          children: [
            jsx('legend', {
              className: styles.legend,
              children: '权限/状态'
            }),
            jsx(KeyValue, {
              label: '允许评论',
              children: media.awemeControl?.canComment ? '是' : '否'
            }),
            jsx(KeyValue, {
              label: '允许分享',
              children: media.awemeControl?.canShare ? '是' : '否'
            }),
            jsx(KeyValue, {
              label: '允许下载',
              children: media.download?.allowDownload ? '是' : '否'
            }),
            jsx(KeyValue, {
              label: '私密视频',
              children: media.isPrivate ? '是' : '否'
            })
          ]
        })
      ]
    });
  JsonTab = ({data}) => {
    const ref = A2(null);
    const sel = () => {
      const r3 = document.createRange();
      r3.selectNodeContents(ref.current);
      const s5 = window.getSelection();
      s5.removeAllRanges();
      s5.addRange(r3);
    };
    return jsx('fieldset', {
      style: {
        overflow: 'hidden',
        border: '1px solid #ddd',
        borderRadius: '4px',
        padding: 10,
        maxHeight: '100%'
      },
      children: [
        jsx('legend', {
          className: styles.legend,
          children: [
            '原始数据',
            jsx('button', {
              onClick: sel,
              className: styles.btn,
              children: '全选'
            }),
            jsx('button', {
              onClick: () => console.log(data),
              className: styles.btn,
              children: 'Console Log'
            })
          ]
        }),
        jsx('pre', {
          className: styles.jsonPre,
          children: jsx('code', {
            ref,
            children: JSON.stringify(data, null, 2)
          })
        })
      ]
    });
  };
  DanmakuTab = () => {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(false);
    const fetchDm = () => {
      try {
        setLoading(true);
        const p3 = window.player;
        if (!p3?.danmaku?.main) {
          setList([]);
          return;
        }
        const raw = p3.danmaku.main.data || [];
        const f4 = raw.map((item, i3) => ({
          index: i3 + 1,
          startTimeStr: msToAssTime(item.start),
          text: item.text || '',
          uid: item.user_id || 0,
          score: item.score || 0
        }));
        setList(f4);
      } catch (err) {
        console.error(err);
        setList([]);
      } finally {
        setLoading(false);
      }
    };
    useEffect(() => {
      fetchDm();
    }, []);
    const copyAll = () => {
      navigator.clipboard.writeText(list.map((i3) => i3.text).join('\n'));
      alert('已复制' + list.length + '条');
    };
    return jsx('div', {
      className: styles.danmakuContainer,
      children: [
        jsx('div', {
          className: styles.danmakuHeader,
          children: [
            jsx('h4', {
              className: styles.danmakuTitle,
              children: ['弹幕列表(', list.length, '条)']
            }),
            jsx('div', {
              className: styles.danmakuButtonGroup,
              children: [
                jsx('button', {
                  className: styles.btn,
                  onClick: fetchDm,
                  disabled: loading,
                  children: '刷新'
                }),
                jsx('button', {
                  className: styles.btn,
                  onClick: copyAll,
                  disabled: list.length === 0,
                  children: '复制全部'
                })
              ]
            })
          ]
        }),
        loading &&
          jsx('div', {
            className: styles.danmakuEmpty,
            children: '加载中...'
          }),
        !loading &&
          list.length === 0 &&
          jsx('div', {
            className: styles.danmakuEmpty,
            children: '暂无弹幕'
          }),
        !loading &&
          list.length > 0 &&
          jsx('div', {
            className: styles.danmakuTableWrapper,
            children: jsx('table', {
              className: styles.table,
              children: [
                jsx('thead', {
                  children: jsx('tr', {
                    children: [
                      jsx('th', {
                        className: styles.th,
                        children: '#'
                      }),
                      jsx('th', {
                        className: styles.th,
                        children: '时间'
                      }),
                      jsx('th', {
                        className: styles.th,
                        children: 'UID'
                      }),
                      jsx('th', {
                        className: styles.th,
                        children: '内容'
                      }),
                      jsx('th', {
                        className: styles.th,
                        children: '评分'
                      }),
                      jsx('th', {
                        className: styles.th,
                        children: '操作'
                      })
                    ]
                  })
                }),
                jsx('tbody', {
                  children: list.map((item) =>
                    jsx(
                      'tr',
                      {
                        children: [
                          jsx('td', {
                            className: styles.td,
                            children: item.index
                          }),
                          jsx('td', {
                            className: styles.td,
                            children: item.startTimeStr
                          }),
                          jsx('td', {
                            className: styles.td,
                            children: item.uid
                          }),
                          jsx('td', {
                            className: styles.td,
                            children: item.text
                          }),
                          jsx('td', {
                            className: styles.td,
                            children: item.score.toFixed(2)
                          }),
                          jsx('td', {
                            className: styles.td,
                            children: jsx('button', {
                              className: styles.btn,
                              onClick: () => navigator.clipboard.writeText(item.text),
                              children: '复制'
                            })
                          })
                        ]
                      },
                      item.index
                    )
                  )
                })
              ]
            })
          })
      ]
    });
  };
  tabs = [
    {
      id: 'media',
      title: '媒体资源',
      Comp: MediaTab
    },
    {
      id: 'author',
      title: '作者信息',
      Comp: AuthorTab
    },
    {
      id: 'post',
      title: '作品信息',
      Comp: PostTab
    },
    {
      id: 'danmaku',
      title: '弹幕列表',
      Comp: DanmakuTab
    },
    {
      id: 'json',
      title: 'JSON',
      Comp: JsonTab
    }
  ];
  MediaDetailModalApp = ({media, filenameBase}) => {
    const [tab, setTab] = useState('media');
    const t3 = tabs.find((t4) => t4.id === tab);
    const props = (id) => {
      switch (id) {
        case 'author':
          return {
            author: media.authorInfo
          };
        case 'json':
          return {
            data: media
          };
        default:
          return {
            media,
            filenameBase
          };
      }
    };
    const Comp = t3.Comp;
    return jsx('div', {
      className: styles.container,
      children: [
        jsx('nav', {
          className: styles.nav,
          children: tabs.map((t4) =>
            jsx(
              'button',
              {
                onClick: () => setTab(t4.id),
                className: navBtnClass(tab === t4.id),
                children: t4.title
              },
              t4.id
            )
          )
        }),
        jsx('div', {
          className: styles.content,
          children: jsx(Comp, {
            ...props(tab)
          })
        })
      ]
    });
  };
  // ─── src/ui/eagle/EaglePicker.tsx · Eagle 文件夹 / 标签选择器 ───────
  var EaglePickerApp, openEaglePicker, closeEaglePicker, eaglePickerRoot, eaglePickerCss, EAGLE_PICKER_SPLIT;
  eaglePickerCss = createCSS();
  eaglePickerRoot = null;
  // 手动输入标签的分隔符：英文/中文逗号、顿号、分号、换行
  EAGLE_PICKER_SPLIT = /[,，、;；\n\r]+/;
  var eaglePickerStyles = {
    overlay: eaglePickerCss({
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483000',
      background: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }),
    panel: eaglePickerCss({
      width: '540px',
      maxWidth: '92vw',
      maxHeight: '76vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(28,28,30,0.98)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '14px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
      color: '#fff',
      fontSize: '13px',
      fontFamily: 'sans-serif',
      overflow: 'hidden'
    }),
    head: eaglePickerCss({
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '12px 14px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      flexShrink: 0
    }),
    search: eaglePickerCss({
      flex: 1,
      minWidth: 0,
      padding: '9px 12px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      fontSize: '13px',
      outline: 'none'
    }),
    hint: eaglePickerCss({
      flexShrink: 0,
      fontSize: '12px',
      color: 'rgba(255,255,255,0.5)'
    }),
    list: eaglePickerCss({
      flexGrow: 1,
      minHeight: '140px',
      overflowY: 'auto',
      padding: '10px 14px',
      scrollbarWidth: 'thin'
    }),
    listTwoCol: eaglePickerCss({
      columnCount: 2,
      columnGap: '14px'
    }),
    item: eaglePickerCss({
      display: 'block',
      padding: '5px 8px',
      marginBottom: '2px',
      borderRadius: '6px',
      color: 'rgba(255,255,255,0.85)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      breakInside: 'avoid',
      '&:hover': {
        background: 'rgba(255,255,255,0.08)'
      }
    }),
    itemActive: eaglePickerCss({
      background: 'rgba(64,150,255,0.28)',
      color: '#fff'
    }),
    itemManual: eaglePickerCss({
      color: '#ffd79a'
    }),
    manual: eaglePickerCss({
      margin: '0 14px 10px',
      padding: '9px 12px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(255,255,255,0.06)',
      color: '#fff',
      fontSize: '13px',
      outline: 'none',
      flexShrink: 0
    }),
    foot: eaglePickerCss({
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0 14px 12px',
      fontSize: '12px',
      color: 'rgba(255,255,255,0.45)',
      flexShrink: 0
    }),
    state: eaglePickerCss({
      padding: '24px',
      textAlign: 'center',
      color: 'rgba(255,255,255,0.55)',
      fontSize: '12px'
    })
  };
  EaglePickerApp = ({mode = 'tag', baseURL = '', selectedTags = [], selectedFolderId = '', onChange, onClose}) => {
    const [keyword, setKeyword] = useState('');
    const [manual, setManual] = useState('');
    const [folders, setFolders] = useState([]);
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const isFolder = mode === 'folder';
    // 弹层内维护自己的选中状态：手动新增的标签要能立刻在列表里看到
    const [localTags, setLocalTags] = useState(Array.isArray(selectedTags) ? selectedTags : []);
    const [localFolderId, setLocalFolderId] = useState(selectedFolderId || '');
    const emitTags = (nextTags) => {
      setLocalTags(nextTags);
      onChange({
        tags: nextTags
      });
    };
    const emitFolder = (id, name) => {
      setLocalFolderId(id);
      onChange({
        folder_id: id,
        folder_name: name
      });
    };
    useEffect(() => {
      let alive = true;
      setLoading(true);
      const client = getEagleClient({
        baseURL
      });
      Promise.all([client.getFolders(), client.getTags()])
        .then((result) => {
          if (!alive) return;
          setFolders(result[0]);
          setTags(result[1]);
          setError('');
        })
        .catch((err) => {
          if (alive) setError(String(err?.message || err));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }, [baseURL]);
    useEffect(() => {
      const onKeyDown = (ev) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          onClose();
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }, []);
    const flatten = (nodes, depth = 0, out = []) => {
      (Array.isArray(nodes) ? nodes : []).forEach((node) => {
        out.push({
          id: node.id,
          name: node.name || '(未命名)',
          depth
        });
        flatten(node.children, depth + 1, out);
      });
      return out;
    };
    const selectedTagList = localTags;
    const keywordTrim = keyword.trim().toLowerCase();
    const manualTags = selectedTagList.filter((name) => !tags.includes(name));
    const mergedTags = [...manualTags, ...tags];
    const visibleTags = keywordTrim
      ? mergedTags.filter((name) => name.toLowerCase().includes(keywordTrim))
      : mergedTags;
    const visibleFolders = keywordTrim
      ? flatten(folders).filter((row) => row.name.toLowerCase().includes(keywordTrim))
      : flatten(folders);
    const addManualTags = () => {
      const parts = String(manual || '')
        .split(EAGLE_PICKER_SPLIT)
        .map((piece) => piece.trim())
        .filter(Boolean);
      if (parts.length === 0) return;
      emitTags(Array.from(new Set([...selectedTagList, ...parts])));
      setManual('');
    };
    const rows = isFolder
      ? [
          jsx(
            'div',
            {
              className: eaglePickerStyles.item + (localFolderId ? '' : ' ' + eaglePickerStyles.itemActive),
              onClick: () => emitFolder('', ''),
              children: '（库根目录）'
            },
            '__root__'
          ),
          ...visibleFolders.map((row) =>
            jsx(
              'div',
              {
                className:
                  eaglePickerStyles.item + (localFolderId === row.id ? ' ' + eaglePickerStyles.itemActive : ''),
                style: {
                  paddingLeft: 8 + row.depth * 14 + 'px'
                },
                onClick: () => emitFolder(row.id, row.name),
                children: row.name
              },
              row.id
            )
          )
        ]
      : visibleTags.map((name) =>
          jsx(
            'div',
            {
              className:
                eaglePickerStyles.item +
                (selectedTagList.includes(name) ? ' ' + eaglePickerStyles.itemActive : '') +
                (tags.includes(name) ? '' : ' ' + eaglePickerStyles.itemManual),
              onClick: () =>
                emitTags(
                  selectedTagList.includes(name)
                    ? selectedTagList.filter((tagName) => tagName !== name)
                    : [...selectedTagList, name]
                ),
              children: name
            },
            name
          )
        );
    return jsx('div', {
      className: eaglePickerStyles.overlay,
      onClick: (ev) => {
        if (ev.target === ev.currentTarget) onClose();
      },
      children: jsx('div', {
        className: eaglePickerStyles.panel,
        children: [
          jsx('div', {
            className: eaglePickerStyles.head,
            children: [
              jsx('input', {
                className: eaglePickerStyles.search,
                value: keyword,
                placeholder: isFolder ? '搜索文件夹...' : '搜索标签...',
                onInput: (ev) => setKeyword(ev.target.value),
                autoFocus: true
              }),
              jsx('span', {
                className: eaglePickerStyles.hint,
                children: isFolder ? '单选' : '可多选'
              })
            ]
          }),
          loading
            ? jsx('div', {
                className: eaglePickerStyles.state,
                children: '正在读取 Eagle...'
              })
            : error
              ? jsx('div', {
                  className: eaglePickerStyles.state,
                  children: '读取失败：' + error
                })
              : jsx('div', {
                  className: eaglePickerStyles.list + (isFolder ? '' : ' ' + eaglePickerStyles.listTwoCol),
                  children:
                    rows.length === 0
                      ? jsx('div', {
                          className: eaglePickerStyles.state,
                          children: '没有匹配项'
                        })
                      : rows
                }),
          !isFolder &&
            jsx('input', {
              className: eaglePickerStyles.manual,
              value: manual,
              placeholder: '手动输入标签，逗号分隔，回车添加',
              onInput: (ev) => setManual(ev.target.value),
              onKeyDown: (ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  addManualTags();
                }
              }
            }),
          jsx('div', {
            className: eaglePickerStyles.foot,
            children: [
              jsx('span', {
                children: isFolder ? '点击选择（层级用缩进表示）' : '点击切换；黄字为手动新增的标签'
              }),
              jsx('span', {
                children: 'Esc 关闭'
              })
            ]
          })
        ]
      })
    });
  };
  closeEaglePicker = () => {
    if (!eaglePickerRoot) return;
    render(null, eaglePickerRoot);
    eaglePickerRoot.remove();
    eaglePickerRoot = null;
  };
  /**
   * 打开 Eagle 选择弹层（命令式调用；作者主页面板与设置弹窗共用）
   */
  openEaglePicker = (options) => {
    closeEaglePicker();
    eaglePickerRoot = document.createElement('div');
    eaglePickerRoot.id = 'dy-dl-eagle-picker-root';
    document.body.appendChild(eaglePickerRoot);
    render(
      jsx(EaglePickerApp, {
        ...options,
        onClose: closeEaglePicker
      }),
      eaglePickerRoot
    );
  };
  // ─── src/ui/modals/ConfigModal.tsx · 设置弹窗 ───────────────────────
  var configModalCss,
    configModalStyles,
    navCls,
    toShortId,
    mockMedia,
    previewFilename,
    previewDirPath,
    eagleFieldStyles,
    SettingsTab,
    DownloaderConfigTab,
    HistoryTab,
    tabs2,
    ConfigModalApp;
  configModalCss = createCSS();
  configModalStyles = {
    container: configModalCss({
      display: 'flex',
      flexDirection: 'column',
      height: '70vh',
      width: '600px',
      overflow: 'hidden',
      background: theme.colors.bgOverlay,
      backdropFilter: theme.backdropBlur,
      color: theme.colors.textPrimary,
      borderRadius: theme.borderRadius.lg
    }),
    header: configModalCss({
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'space-between',
      borderBottom: '1px solid ' + theme.colors.borderLight,
      background: theme.colors.bgNav,
      flexShrink: 0
    }),
    nav: configModalCss({
      display: 'flex',
      flexShrink: 0
    }),
    actions: configModalCss({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing.sm,
      padding: theme.spacing.sm + ' ' + theme.spacing.md
    }),
    navBtnBase: configModalCss({
      padding: theme.spacing.md + ' ' + theme.spacing.xl,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      borderBottom: '2px solid transparent',
      fontWeight: 'normal',
      color: theme.colors.textSecondary,
      transition: '0.2s',
      '&:hover': {
        background: 'rgba(255,255,255,0.05)'
      }
    }),
    navBtnActive: configModalCss({
      background: 'rgba(255,255,255,0.08)',
      borderBottomColor: theme.colors.primary,
      fontWeight: 'bold',
      color: theme.colors.primary
    }),
    content: configModalCss({
      flexGrow: 1,
      overflowY: 'auto',
      padding: theme.spacing.xl
    }),
    fieldset: configModalCss({
      border: '1px solid ' + theme.colors.borderMedium,
      borderRadius: theme.borderRadius.md,
      marginBottom: theme.spacing.xl,
      padding: theme.spacing.lg,
      background: theme.colors.bgFieldset
    }),
    legend: configModalCss({
      fontWeight: 'bold',
      padding: '0 ' + theme.spacing.sm,
      color: 'rgba(255,255,255,0.9)',
      background: 'rgba(18,18,20,0.8)',
      borderRadius: theme.borderRadius.full,
      fontSize: theme.fontSize.sm
    }),
    row: configModalCss({
      display: 'flex',
      padding: theme.spacing.sm + ' 0',
      fontSize: theme.fontSize.sm,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      alignItems: 'center'
    }),
    label: configModalCss({
      width: '120px',
      flexShrink: 0,
      color: theme.colors.textMuted,
      fontWeight: 600
    }),
    value: configModalCss({
      flexGrow: 1,
      color: theme.colors.textSecondary,
      wordBreak: 'break-all'
    }),
    btn: configModalCss({
      padding: theme.spacing.xs + ' ' + theme.spacing.md,
      fontSize: theme.fontSize.xs,
      cursor: 'pointer',
      border: '1px solid rgba(255,255,255,0.3)',
      background: 'rgba(255,255,255,0.08)',
      color: theme.colors.textPrimary,
      borderRadius: theme.borderRadius.full,
      marginLeft: theme.spacing.sm,
      transition: '0.2s',
      whiteSpace: 'nowrap'
    }),
    btnDanger: configModalCss({
      padding: theme.spacing.xs + ' ' + theme.spacing.md,
      fontSize: theme.fontSize.xs,
      cursor: 'pointer',
      border: '1px solid #ff4d4f',
      background: 'rgba(255,77,79,0.15)',
      color: '#ff4d4f',
      borderRadius: theme.borderRadius.full,
      transition: '0.2s'
    }),
    select: configModalCss({
      background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: theme.colors.textPrimary,
      borderRadius: theme.borderRadius.sm,
      padding: theme.spacing.xs + ' ' + theme.spacing.sm,
      fontSize: theme.fontSize.xs,
      '& option': {
        background: '#2c2c2e',
        color: theme.colors.textPrimary,
        padding: theme.spacing.sm
      }
    }),
    input: configModalCss({
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.15)',
      color: theme.colors.textPrimary,
      borderRadius: theme.borderRadius.sm,
      padding: theme.spacing.sm + ' ' + theme.spacing.md,
      fontSize: theme.fontSize.sm,
      lineHeight: '20px',
      flexGrow: 1,
      minWidth: 0,
      '&:focus': {
        borderColor: theme.colors.primary
      }
    }),
    table: configModalCss({
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: theme.fontSize.xs
    }),
    th: configModalCss({
      textAlign: 'left',
      padding: theme.spacing.sm,
      borderBottom: '1px solid ' + theme.colors.borderMedium,
      color: theme.colors.textMuted,
      fontWeight: 600
    }),
    td: configModalCss({
      padding: theme.spacing.sm,
      borderBottom: '1px solid ' + theme.colors.borderLight,
      verticalAlign: 'top'
    }),
    range: configModalCss({
      flexGrow: 1,
      accentColor: theme.colors.primary,
      cursor: 'pointer'
    }),
    rangeValue: configModalCss({
      minWidth: '32px',
      textAlign: 'right',
      fontSize: theme.fontSize.xs,
      color: theme.colors.textSecondary
    }),
    flexBetween: configModalCss({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.sm
    }),
    hintText: configModalCss({
      fontSize: '11px',
      color: theme.colors.textDim,
      marginTop: theme.spacing.xs,
      padding: theme.spacing.xs + ' 0',
      lineHeight: 1.5
    }),
    codeBlock: configModalCss({
      background: 'rgba(0,0,0,0.3)',
      borderRadius: theme.borderRadius.sm,
      padding: '4px ' + theme.spacing.sm,
      fontSize: '11px',
      color: theme.colors.textSecondary,
      fontFamily: 'monospace',
      wordBreak: 'break-all'
    }),
    hr: configModalCss({
      border: 'none',
      borderTop: '1px solid ' + theme.colors.borderLight,
      margin: theme.spacing.sm + ' 0'
    }),
    btnSave: configModalCss({
      padding: theme.spacing.xs + ' ' + theme.spacing.md,
      fontSize: theme.fontSize.xs,
      cursor: 'pointer',
      border: '1px solid rgba(255,255,255,0.3)',
      background: 'rgba(255,255,255,0.08)',
      color: theme.colors.textPrimary,
      borderRadius: theme.borderRadius.full,
      marginLeft: theme.spacing.sm,
      transition: '0.2s',
      whiteSpace: 'nowrap'
    }),
    btnSaveDirty: configModalCss({
      padding: theme.spacing.xs + ' ' + theme.spacing.md,
      fontSize: theme.fontSize.xs,
      cursor: 'pointer',
      border: '2px solid ' + theme.colors.primary,
      background: 'rgba(64,150,255,0.2)',
      color: theme.colors.primary,
      borderRadius: theme.borderRadius.full,
      marginLeft: theme.spacing.sm,
      transition: '0.2s',
      whiteSpace: 'nowrap',
      fontWeight: 'bold'
    })
  };
  navCls = (a3) =>
    a3 ? configModalStyles.navBtnBase + ' ' + configModalStyles.navBtnActive : configModalStyles.navBtnBase;
  toShortId = (bigintStr) => {
    try {
      return BigInt(bigintStr).toString(36);
    } catch {
      return bigintStr;
    }
  };
  mockMedia = {
    authorInfo: {
      nickname: '示例用户'
    },
    awemeId: '1234567890123456789',
    desc: '这是一个示例视频描述 #tag1 #tag2',
    textExtra: [
      {
        hashtagName: 'tag1'
      },
      {
        hashtagName: 'tag2'
      }
    ],
    authorUserId: '12345',
    createTime: Date.now() / 1e3
  };
  previewFilename = (template, maxLen) => {
    const {
      authorInfo: {nickname},
      awemeId,
      desc,
      textExtra
    } = mockMedia;
    const short_id = toShortId(awemeId);
    const tag_list = textExtra?.map((x2) => x2.hashtagName).filter(Boolean) || [];
    const tags = tag_list.map((x2) => '#' + x2).join('_');
    let rawDesc = desc || '';
    tag_list.forEach((t3) => {
      rawDesc = rawDesc.replace(new RegExp('#' + t3 + '\\s*', 'g'), '');
    });
    rawDesc = rawDesc.trim().replace(/[#/?<>\\:*|":]/g, '_');
    const now_date = new Date();
    const create_date = new Date(Number(mockMedia.createTime) * 1e3);
    const ctx = {
      nickname,
      short_id,
      tags,
      desc: rawDesc,
      aweme_id: awemeId,
      media: mockMedia,
      author_info: mockMedia.authorInfo,
      uid: mockMedia.authorUserId,
      music_name: '',
      now_date,
      create_date,
      now_YYYYMMDD: formatDate(now_date, 'YYYYMMDD'),
      now_YYYYMMDD_HHmmss: formatDate(now_date, 'YYYYMMDD_HHmmss'),
      create_date_YYYYMMDD: formatDate(create_date, 'YYYYMMDD'),
      create_date_YYYYMMDD_HHmmss: formatDate(create_date, 'YYYYMMDD_HHmmss')
    };
    let base;
    try {
      base = runInContext(ctx, template);
    } catch {
      base = runInContext(ctx, '`${nickname}_${short_id}_${tags}_${desc}`');
    }
    return normalizeBasename(base, {
      maxLength: maxLen
    });
  };
  previewDirPath = (template) => {
    if (!template) return '';
    const {
      authorInfo: {nickname},
      awemeId,
      desc,
      authorUserId
    } = mockMedia;
    const uid = authorUserId;
    const userDir = normalizePathSegment(`${uid}_${nickname}`);
    const ctx = {
      user_dir: userDir,
      nickname,
      uid,
      aweme_id: awemeId,
      desc,
      filename: 'example.mp4',
      filename_base: 'example',
      media: mockMedia
    };
    let resolved;
    try {
      resolved = runInContext(ctx, template);
    } catch {
      resolved = '(无法解析)';
    }
    return typeof resolved === 'string' ? resolved : String(resolved);
  };
  SettingsTab = ({cfg, onChange, onResetDefaults}) => {
    const filenamePreview = T2(
      () => previewFilename(cfg.filename_template, cfg.filename_max_length),
      [cfg.filename_template, cfg.filename_max_length]
    );
    const update = (mutate) => {
      mutate();
      onChange();
    };
    return jsx('div', {
      children: [
        jsx('fieldset', {
          className: configModalStyles.fieldset,
          children: [
            jsx('legend', {
              className: configModalStyles.legend,
              children: '文件命名'
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '文件名模板'
                }),
                jsx('input', {
                  className: configModalStyles.input,
                  value: cfg.filename_template,
                  onChange: (e3) => update(() => (cfg.filename_template = e3.target.value))
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.hintText,
              children: [
                '可用变量：',
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: 'nickname'
                }),
                ' ',
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: 'short_id'
                }),
                ' ',
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: 'tags'
                }),
                ' ',
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: 'desc'
                }),
                ' ',
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: 'aweme_id'
                }),
                ' ',
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: 'create_date_YYYYMMDD'
                }),
                ' ',
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: 'now_YYYYMMDD_HHmmss'
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '文件名长度'
                }),
                jsx('input', {
                  className: configModalStyles.input,
                  type: 'number',
                  value: cfg.filename_max_length,
                  onChange: (e3) => update(() => (cfg.filename_max_length = Number(e3.target.value)))
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '预览'
                }),
                jsx('span', {
                  className: configModalStyles.codeBlock,
                  children: filenamePreview || '(无法预览)'
                })
              ]
            })
          ]
        }),
        jsx('fieldset', {
          className: configModalStyles.fieldset,
          children: [
            jsx('legend', {
              className: configModalStyles.legend,
              children: '视频下载设置'
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '分辨率策略'
                }),
                jsx('select', {
                  className: configModalStyles.select,
                  value: cfg.download_video_mode,
                  onChange: (e3) => update(() => (cfg.download_video_mode = e3.target.value)),
                  children: [
                    jsx('option', {
                      value: 'default',
                      children: '默认'
                    }),
                    jsx('option', {
                      value: 'max',
                      children: '最高清晰度'
                    }),
                    jsx('option', {
                      value: 'min',
                      children: '最低清晰度'
                    }),
                    jsx('option', {
                      value: '1080P',
                      children: '1080P'
                    }),
                    jsx('option', {
                      value: '720P',
                      children: '720P'
                    }),
                    jsx('option', {
                      value: '540P',
                      children: '540P'
                    }),
                    jsx('option', {
                      value: '360P',
                      children: '360P'
                    }),
                    jsx('option', {
                      value: '2K',
                      children: '2K'
                    }),
                    jsx('option', {
                      value: '4K',
                      children: '4K'
                    }),
                    jsx('option', {
                      value: 'max_file',
                      children: '最大文件'
                    }),
                    jsx('option', {
                      value: 'min_file',
                      children: '最小文件'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '编码偏好'
                }),
                jsx('select', {
                  className: configModalStyles.select,
                  value: cfg.video_download_codecs,
                  onChange: (e3) => update(() => (cfg.video_download_codecs = e3.target.value)),
                  children: [
                    jsx('option', {
                      value: 'default',
                      children: '默认'
                    }),
                    jsx('option', {
                      value: 'h264',
                      children: 'H.264'
                    }),
                    jsx('option', {
                      value: 'h265',
                      children: 'H.265'
                    }),
                    jsx('option', {
                      value: 'h264_prefer',
                      children: '优先H.264'
                    }),
                    jsx('option', {
                      value: 'h265_prefer',
                      children: '优先H.265'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.hintText,
              children: '注意：实际下载时根据可用地址匹配，并非所有视频都提供所有编码。'
            })
          ]
        }),
        jsx('fieldset', {
          className: configModalStyles.fieldset,
          children: [
            jsx('legend', {
              className: configModalStyles.legend,
              children: '快捷键'
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '启用快捷键'
                }),
                jsx('label', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    cursor: 'pointer'
                  },
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: cfg.enable_download_shortcut,
                      onChange: (e3) => update(() => (cfg.enable_download_shortcut = e3.target.checked))
                    }),
                    jsx('span', {
                      children: '启用下载快捷键'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '下载快捷键'
                }),
                jsx('input', {
                  className: configModalStyles.input,
                  value: cfg.download_shortcut,
                  placeholder: 'M / Ctrl+Shift+M',
                  disabled: !cfg.enable_download_shortcut,
                  onChange: (e3) => update(() => (cfg.download_shortcut = e3.target.value))
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '启用 Eagle 快捷键'
                }),
                jsx('label', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    cursor: 'pointer'
                  },
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: cfg.enable_eagle_shortcut !== false,
                      onChange: (e3) => update(() => (cfg.enable_eagle_shortcut = e3.target.checked))
                    }),
                    jsx('span', {
                      children: '启用推送到 Eagle 快捷键'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: 'Eagle 快捷键'
                }),
                jsx('input', {
                  className: configModalStyles.input,
                  value: cfg.eagle_shortcut,
                  placeholder: 'S / Ctrl+Shift+S',
                  disabled: cfg.enable_eagle_shortcut === false,
                  onChange: (e3) => update(() => (cfg.eagle_shortcut = e3.target.value))
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.hintText,
              children: '支持单键或组合键，例如 S、Ctrl+S、Alt+M、Shift+M、Ctrl+Shift+M。输入框聚焦时快捷键不触发。'
            })
          ]
        }),
        jsx('fieldset', {
          className: configModalStyles.fieldset,
          children: [
            jsx('legend', {
              className: configModalStyles.legend,
              children: '重置配置'
            }),
            jsx('div', {
              className: configModalStyles.hintText,
              children: '重置会将当前表单所有配置恢复为默认值，保存后覆盖现有全部配置。'
            }),
            jsx('button', {
              className: configModalStyles.btnDanger,
              onClick: onResetDefaults,
              children: '重置配置为默认'
            })
          ]
        })
      ]
    });
  };
  eagleFieldStyles = {
    chips: configModalCss({
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      marginTop: theme.spacing.sm
    }),
    chip: configModalCss({
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 10px',
      borderRadius: theme.borderRadius.full,
      background: 'rgba(64,150,255,0.18)',
      border: '1px solid rgba(64,150,255,0.5)',
      color: theme.colors.textPrimary,
      fontSize: theme.fontSize.xs
    }),
    chipX: configModalCss({
      cursor: 'pointer',
      opacity: 0.75,
      '&:hover': {
        opacity: 1
      }
    }),
    treeBox: configModalCss({
      maxHeight: '240px',
      overflowY: 'auto',
      marginTop: theme.spacing.sm,
      padding: theme.spacing.sm,
      background: 'rgba(0,0,0,0.28)',
      border: '1px solid ' + theme.colors.borderLight,
      borderRadius: theme.borderRadius.sm
    }),
    treeRow: configModalCss({
      padding: '3px 6px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: theme.fontSize.xs,
      color: theme.colors.textSecondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      '&:hover': {
        background: 'rgba(255,255,255,0.08)'
      }
    }),
    treeRowActive: configModalCss({
      background: 'rgba(64,150,255,0.22)',
      color: theme.colors.textPrimary
    }),
    tagListBox: configModalCss({
      maxHeight: '220px',
      overflowY: 'auto',
      marginTop: theme.spacing.sm,
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      padding: theme.spacing.sm,
      background: 'rgba(0,0,0,0.28)',
      border: '1px solid ' + theme.colors.borderLight,
      borderRadius: theme.borderRadius.sm
    }),
    tagOption: configModalCss({
      padding: '2px 10px',
      borderRadius: theme.borderRadius.full,
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }),
    tagOptionActive: configModalCss({
      background: 'rgba(254,44,85,0.25)',
      borderColor: theme.colors.primary,
      color: '#fff'
    }),
    statusOk: configModalCss({
      color: '#81c784',
      fontSize: theme.fontSize.xs,
      padding: theme.spacing.xs + ' 0'
    }),
    statusErr: configModalCss({
      color: '#ef9a9a',
      fontSize: theme.fontSize.xs,
      padding: theme.spacing.xs + ' 0'
    })
  };
  DownloaderConfigTab = ({cfg, onChange}) => {
    const [dlType, setDlType] = useState(cfg.using_downloader);
    const [, forceRender] = useState(0);
    useEffect(() => {
      setDlType(cfg.using_downloader);
    }, [cfg.using_downloader]);
    const dc = cfg.downloader_config || {};
    const notify = () => {
      forceRender((v3) => v3 + 1);
      onChange();
    };
    const setField = (path, val) => {
      val = val.replace(/\\/g, '/');
      const parts = path.split('.');
      let obj = dc[dlType];
      if (!obj) {
        obj = {};
        dc[dlType] = obj;
      }
      for (let i3 = 0; i3 < parts.length - 1; i3++) {
        if (typeof obj[parts[i3]] !== 'object') obj[parts[i3]] = {};
        obj = obj[parts[i3]];
      }
      obj[parts[parts.length - 1]] = val;
      cfg.downloader_config = {
        ...dc
      };
      notify();
    };
    const rawDcfg = dc[dlType] || {};
    const downloaderDefaults = Config.default_features().downloader_config[dlType] || {};
    const dcfg = {
      ...downloaderDefaults,
      ...rawDcfg,
      dir: {
        ...(downloaderDefaults.dir || {}),
        ...(rawDcfg.dir || {})
      }
    };
    const renderBrowserImageFields = () =>
      jsx(Fragment, {
        children: [
          jsx('div', {
            className: configModalStyles.hintText,
            children:
              '以下图片转码/压缩配置仅在“浏览器下载”时生效。使用外部下载器时，脚本只能把原图地址交给下载器，无法自动转码或压缩。'
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '转码格式'
              }),
              jsx('select', {
                className: configModalStyles.select,
                value: cfg.image_convert_codecs,
                onChange: (e3) => {
                  cfg.image_convert_codecs = e3.target.value;
                  notify();
                },
                children: [
                  jsx('option', {
                    value: 'default',
                    children: '默认'
                  }),
                  jsx('option', {
                    value: 'png',
                    children: 'PNG'
                  }),
                  jsx('option', {
                    value: 'jpg',
                    children: 'JPG'
                  }),
                  jsx('option', {
                    value: 'webp',
                    children: 'WebP'
                  })
                ]
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '尺寸限制'
              }),
              jsx('select', {
                className: configModalStyles.select,
                value: cfg.image_resize_codecs,
                onChange: (e3) => {
                  cfg.image_resize_codecs = e3.target.value;
                  notify();
                },
                children: [
                  jsx('option', {
                    value: 'default',
                    children: '默认'
                  }),
                  jsx('option', {
                    value: '2k_max',
                    children: '2K(2048px)'
                  }),
                  jsx('option', {
                    value: '1k_max',
                    children: '1K(1024px)'
                  }),
                  jsx('option', {
                    value: '960_max',
                    children: '960px'
                  }),
                  jsx('option', {
                    value: '640_max',
                    children: '640px'
                  }),
                  jsx('option', {
                    value: '512_max',
                    children: '512px'
                  })
                ]
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.flexBetween,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '图片质量'
              }),
              jsx('span', {
                className: configModalStyles.rangeValue,
                children: [cfg.image_quality, '%']
              })
            ]
          }),
          jsx('input', {
            className: configModalStyles.range,
            type: 'range',
            min: '1',
            max: '100',
            value: cfg.image_quality,
            onChange: (e3) => {
              cfg.image_quality = Number(e3.target.value);
              notify();
            }
          }),
          jsx('div', {
            className: configModalStyles.hintText,
            children: '压缩率仅当转码或尺寸压缩开启时生效，推荐 60% 以上。'
          })
        ]
      });
    const defaultDirs = downloaderDefaults.dir || {};
    const renderDirFields = () =>
      jsx(Fragment, {
        children: [
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '视频目录'
              }),
              jsx('input', {
                className: configModalStyles.input,
                value: dcfg.dir?.video || defaultDirs.video || '',
                onChange: (e3) => setField('dir.video', e3.target.value)
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '图片目录'
              }),
              jsx('input', {
                className: configModalStyles.input,
                value: dcfg.dir?.image || defaultDirs.image || '',
                onChange: (e3) => setField('dir.image', e3.target.value)
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '其他目录'
              }),
              jsx('input', {
                className: configModalStyles.input,
                value: dcfg.dir?.other || defaultDirs.other || '',
                onChange: (e3) => setField('dir.other', e3.target.value)
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.hintText,
            children: [
              '可用变量：',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '${user_dir}'
              }),
              ' ',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '${nickname}'
              }),
              ' ',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '${uid}'
              }),
              ' ',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '${aweme_id}'
              }),
              ' ',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '${desc}'
              }),
              ' ',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '${filename}'
              }),
              ' ',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '${filename_base}'
              }),
              jsx('br', {}),
              '使用模板字符串语法，如：',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: '`./douyin/${user_dir}/videos`'
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.hintText,
            children: [
              '预览视频目录：',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: previewDirPath(dcfg.dir?.video || defaultDirs.video || '')
              }),
              jsx('br', {}),
              '预览图片目录：',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: previewDirPath(dcfg.dir?.image || defaultDirs.image || '')
              }),
              jsx('br', {}),
              '预览其他目录：',
              jsx('span', {
                className: configModalStyles.codeBlock,
                children: previewDirPath(dcfg.dir?.other || defaultDirs.other || '')
              })
            ]
          })
        ]
      });
    // ── Eagle 推送配置：目录与标签改用弹层选择（弹层自行拉取 Eagle 数据） ──
    const eagleCfg = (cfg.downloader_config || {}).eagle || {};
    const setEagleField = (patch) => {
      const nextConfig = {
        ...(cfg.downloader_config || {})
      };
      nextConfig.eagle = {
        ...(nextConfig.eagle || {}),
        ...patch
      };
      cfg.downloader_config = nextConfig;
      notify();
    };
    /**
     * 推送记录相关设置：除更新面板 draft 外，立即写回全局配置并持久化。
     * 原因：这组开关挂在独立的「Eagle 推送记录」区，不属于「类型 = Eagle」的字段组；
     * 只走 setEagleField 时，其改动可能不进面板保存的 changedPaths（表现为取消勾选后保存又变回选中）。
     */
    const setPushField = (patch) => {
      setEagleField(patch);
      try {
        const feat = Config.global.features;
        if (feat && feat.downloader_config && feat.downloader_config.eagle) {
          Object.assign(feat.downloader_config.eagle, patch);
          Config.global.save();
        }
        console.log('[dy-dl] 推送记录设置：', JSON.stringify(patch));
      } catch (err) {
        console.warn('[dy-dl] 推送记录设置保存失败', err);
      }
    };
    /** 从 Eagle 库重建记录（Eagle 库在本机，是权威的本地记录） */
    const queueRebuildPushRecords = async () => {
      if (!confirm('将从 Eagle 素材库里扫描作品，重建「已推送」记录（已有记录不受影响）。继续？')) return;
      try {
        console.log('[dy-dl] 开始从 Eagle 重建推送记录…');
        const r = await PushHistory.rebuildFromEagle();
        PushHistory.list().forEach((rec) => {
          try {
            if (
              typeof domPatcher !== 'undefined' &&
              domPatcher &&
              typeof domPatcher.refreshPushedBadgeFor === 'function'
            ) {
              domPatcher.refreshPushedBadgeFor(rec.awemeId);
            }
          } catch (err) {}
        });
        console.log('[dy-dl] 重建完成', r);
        alert('重建完成：扫描 ' + r.scanned + ' 个素材，新增 ' + r.added + ' 条记录（当前共 ' + r.disk + ' 条）。');
      } catch (err) {
        console.warn('[dy-dl] 从 Eagle 重建失败', err);
        alert(
          '重建失败：' +
            (err && err.message ? err.message : err) +
            '\n请确认 Eagle 正在运行，且「下载器配置 → Eagle」里的服务地址正确。'
        );
      }
    };
    /** 导出记录为 JSON 文件 */
    const exportPushRecords = async () => {
      try {
        const data = await PushHistory.exportData();
        if (!data.records.length) {
          alert('当前没有推送记录可导出');
          return;
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'douyin-push-records.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch (err) {}
        }, 5000);
        console.log('[dy-dl] 已导出推送记录', data.records.length, '条');
      } catch (err) {
        console.warn('[dy-dl] 导出推送记录失败', err);
        alert('导出失败：' + (err && err.message ? err.message : err));
      }
    };
    /** 从 JSON 文件导入记录（合并，不覆盖已有的更大计数） */
    const importPushRecords = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const parsed = JSON.parse(String(reader.result || ''));
            const list = Array.isArray(parsed)
              ? parsed
              : parsed && Array.isArray(parsed.records)
                ? parsed.records
                : null;
            if (!list) {
              alert('文件格式不对：没找到 records 数组');
              return;
            }
            const n = await PushHistory.importRecords(list);
            console.log('[dy-dl] 已导入推送记录', n, '条');
            alert('已导入 ' + n + ' 条记录（当前共 ' + PushHistory.count() + ' 条）');
          } catch (err) {
            console.warn('[dy-dl] 导入推送记录失败', err);
            alert('导入失败：' + (err && err.message ? err.message : err));
          }
        };
        reader.readAsText(file);
      };
      input.click();
    };
    const [eagleProbe, setEagleProbe] = useState('');
    const [eagleProbeOk, setEagleProbeOk] = useState(false);
    const [eagleProbing, setEagleProbing] = useState(false);
    const probeEagle = async () => {
      setEagleProbing(true);
      setEagleProbe('正在连接 Eagle...');
      setEagleProbeOk(false);
      try {
        const client = getEagleClient({
          baseURL: eagleCfg.base_url
        });
        const style = await client.getApiStyle(true);
        const tree = await client.getFolders(true);
        const tagList = await client.getTags(true);
        setEagleProbe(`已连接 Eagle（API ${style}）：${tree.length} 个顶层文件夹 / ${tagList.length} 个标签`);
        setEagleProbeOk(true);
      } catch (err) {
        setEagleProbe(`连接失败：${err?.message || err}`);
        setEagleProbeOk(false);
      } finally {
        setEagleProbing(false);
      }
    };
    useEffect(() => {
      probeEagle();
    }, [eagleCfg.base_url]);
    const selectedTagNames = Array.isArray(eagleCfg.tags) ? eagleCfg.tags : [];
    const openTagPicker = () => {
      openEaglePicker({
        mode: 'tag',
        baseURL: eagleCfg.base_url,
        selectedTags: selectedTagNames,
        onChange: (patch) => setEagleField(patch)
      });
    };
    const openFolderPicker = () => {
      openEaglePicker({
        mode: 'folder',
        baseURL: eagleCfg.base_url,
        selectedFolderId: eagleCfg.folder_id || '',
        onChange: (patch) => setEagleField(patch)
      });
    };
    const renderAnimatedImageFields = () =>
      jsx(Fragment, {
        children: [
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '动图格式'
              }),
              jsx('select', {
                className: configModalStyles.select,
                value: cfg.animated_image_mode || 'webp',
                onChange: (e3) => {
                  cfg.animated_image_mode = e3.target.value;
                  notify();
                },
                children: [
                  jsx('option', {
                    value: 'webp',
                    children: '高清图（webp）'
                  }),
                  jsx('option', {
                    value: 'video',
                    children: '动图（mp4）'
                  }),
                  jsx('option', {
                    value: 'both',
                    children: '两者都要'
                  })
                ]
              })
            ]
          }),
          jsx('label', {
            className: configModalStyles.row,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              cursor: 'pointer'
            },
            children: [
              jsx('input', {
                type: 'checkbox',
                checked: cfg.prefer_origin_image !== false,
                onChange: (e3) => {
                  cfg.prefer_origin_image = e3.target.checked;
                  notify();
                }
              }),
              jsx('span', {
                children: '下载原图（优先取原图地址，取不到时回退到展示图）'
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.hintText,
            children:
              '「动图」指图文作品里的实况图（一张静态图 + 一段预览 MP4）。高清图取静态图地址（通常为 webp，分辨率明显更高）；动图取那段 MP4（会动，但分辨率较低）。对所有下载器（含 Eagle）生效。'
          })
        ]
      });
    const renderEagleFields = () =>
      jsx('div', {
        children: [
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '服务地址'
              }),
              jsx('input', {
                className: configModalStyles.input,
                value: eagleCfg.base_url || '',
                onChange: (e3) =>
                  setEagleField({
                    base_url: e3.target.value
                  })
              }),
              jsx('button', {
                className: configModalStyles.btnSave,
                onClick: probeEagle,
                disabled: eagleProbing,
                children: eagleProbing ? '连接中...' : '检测连接'
              })
            ]
          }),
          eagleProbe
            ? jsx('div', {
                className: eagleProbeOk ? eagleFieldStyles.statusOk : eagleFieldStyles.statusErr,
                children: eagleProbe
              })
            : null,
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '目标文件夹'
              }),
              jsx('span', {
                className: configModalStyles.value,
                children: eagleCfg.folder_id ? eagleCfg.folder_name || eagleCfg.folder_id : '库根目录（未选择）'
              }),
              jsx('button', {
                className: configModalStyles.btnSave,
                onClick: openFolderPicker,
                children: '选择文件夹'
              }),
              eagleCfg.folder_id
                ? jsx('button', {
                    className: configModalStyles.btnDanger,
                    onClick: () =>
                      setEagleField({
                        folder_id: '',
                        folder_name: ''
                      }),
                    children: '用根目录'
                  })
                : null
            ]
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '标签'
              }),
              jsx('span', {
                className: configModalStyles.value,
                children:
                  selectedTagNames.length === 0
                    ? '未选择（素材不带任何标签）'
                    : '已选 ' + selectedTagNames.length + ' 个'
              }),
              jsx('button', {
                className: configModalStyles.btnSave,
                onClick: openTagPicker,
                children: '选择标签'
              }),
              selectedTagNames.length > 0
                ? jsx('button', {
                    className: configModalStyles.btnDanger,
                    onClick: () =>
                      setEagleField({
                        tags: []
                      }),
                    children: '清空标签'
                  })
                : null
            ]
          }),
          selectedTagNames.length > 0
            ? jsx('div', {
                className: eagleFieldStyles.chips,
                children: selectedTagNames.map((name) =>
                  jsx(
                    'span',
                    {
                      className: eagleFieldStyles.chip,
                      children: name
                    },
                    name
                  )
                )
              })
            : null,
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '作者归类'
              }),
              jsx('label', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  cursor: 'pointer'
                },
                children: [
                  jsx('input', {
                    type: 'checkbox',
                    checked: eagleCfg.author_as_tag === true,
                    onChange: (e3) =>
                      setEagleField({
                        author_as_tag: e3.target.checked
                      })
                  }),
                  jsx('span', {
                    children: '作者名为标签（把作者昵称追加为素材标签）'
                  })
                ]
              }),
              jsx('label', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  cursor: 'pointer'
                },
                children: [
                  jsx('input', {
                    type: 'checkbox',
                    checked: eagleCfg.author_as_folder === true,
                    onChange: (e3) =>
                      setEagleField({
                        author_as_folder: e3.target.checked
                      })
                  }),
                  jsx('span', {
                    children: '作者名为文件夹（在目标文件夹下按作者名建子文件夹）'
                  })
                ]
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '去重'
              }),
              jsx('label', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  cursor: 'pointer'
                },
                children: [
                  jsx('input', {
                    type: 'checkbox',
                    checked: eagleCfg.skip_existing !== false,
                    onChange: (e3) =>
                      setEagleField({
                        skip_existing: e3.target.checked
                      })
                  }),
                  jsx('span', {
                    children: '推送前检查 Eagle 里是否已有同一作品同一张图，已存在则跳过'
                  })
                ]
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '请求头'
              }),
              jsx('label', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  cursor: 'pointer'
                },
                children: [
                  jsx('input', {
                    type: 'checkbox',
                    checked: eagleCfg.send_referer !== false,
                    onChange: (e3) =>
                      setEagleField({
                        send_referer: e3.target.checked
                      })
                  }),
                  jsx('span', {
                    children: '给抖音 CDN 补 Referer / User-Agent（推荐开启）'
                  })
                ]
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.row,
            children: [
              jsx('span', {
                className: configModalStyles.label,
                children: '播放页'
              }),
              jsx('label', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  cursor: 'pointer'
                },
                children: [
                  jsx('input', {
                    type: 'checkbox',
                    checked: eagleCfg.show_player_button === true,
                    onChange: (e3) =>
                      setEagleField({
                        show_player_button: e3.target.checked
                      })
                  }),
                  jsx('span', {
                    children: '显示「插件」按钮与「已推送」徽标（关掉后仍可用快捷键推送）'
                  })
                ]
              })
            ]
          }),
          jsx('div', {
            className: configModalStyles.hintText,
            children:
              '目录与标签用弹层选择，点击后立即生效并记住。Eagle 会自行拉取媒体直链入库；视频优先使用带签名的 CDN 直链。不选择标签时，素材不会写入任何标签。勾选「作者名为文件夹」后，素材会放进以作者昵称命名的子文件夹（没有则自动创建）；勾选「作者名为标签」则把作者昵称追加为标签。'
          })
        ]
      });
    return jsx('div', {
      children: [
        jsx('fieldset', {
          className: configModalStyles.fieldset,
          children: [
            jsx('legend', {
              className: configModalStyles.legend,
              children: '下载器'
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '类型'
                }),
                jsx('select', {
                  className: configModalStyles.select,
                  value: dlType,
                  onChange: (e3) => {
                    const next = e3.target.value;
                    setDlType(next);
                    cfg.using_downloader = next;
                    notify();
                  },
                  children: [
                    jsx('option', {
                      value: 'browser',
                      children: '浏览器'
                    }),
                    jsx('option', {
                      value: 'eagle',
                      children: 'Eagle（推送到素材库）'
                    }),
                    jsx('option', {
                      value: 'idm',
                      children: 'IDM'
                    }),
                    jsx('option', {
                      value: 'aria2',
                      children: 'Aria2'
                    }),
                    jsx('option', {
                      value: 'bc',
                      children: 'BitComet'
                    }),
                    jsx('option', {
                      value: 'abdm',
                      children: 'AB Download Manager'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.hintText,
              children:
                '切换下载器会立即显示对应配置，保存后才会用于实际下载。使用外部下载器（含 Eagle）时，图片压缩转码不可用。'
            })
          ]
        }),
        jsx('fieldset', {
          className: configModalStyles.fieldset,
          children: [
            jsx('legend', {
              className: configModalStyles.legend,
              children: '动图（实况）'
            }),
            renderAnimatedImageFields()
          ]
        }),
        jsx('fieldset', {
          className: configModalStyles.fieldset,
          children: [
            jsx('legend', {
              className: configModalStyles.legend,
              children: 'Eagle 推送记录'
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '推送记录'
                }),
                jsx('label', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    cursor: 'pointer'
                  },
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: eagleCfg.push_history !== false,
                      onChange: (e3) =>
                        setPushField({
                          push_history: e3.target.checked
                        })
                    }),
                    jsx('span', {
                      children: '记住已推送过的作品（关掉后不再写入记录）'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '已推送标记'
                }),
                jsx('label', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    cursor: 'pointer'
                  },
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: eagleCfg.push_badge !== false,
                      onChange: (e3) =>
                        setPushField({
                          push_badge: e3.target.checked
                        })
                    }),
                    jsx('span', {
                      children: '在作者主页卡片与详情页显示「已推送」徽标'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '记录保留'
                }),
                jsx('label', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    cursor: 'pointer'
                  },
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: eagleCfg.push_record_forever === true,
                      onChange: (e3) =>
                        setPushField({
                          push_record_forever: e3.target.checked
                        })
                    }),
                    jsx('span', {
                      children: '永久保留（默认 365 天后自动清理）'
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '记录上限'
                }),
                jsx('select', {
                  style: {
                    padding: '4px 8px',
                    borderRadius: '6px'
                  },
                  value: String(readPushCfg().cap),
                  onChange: (e3) => setPushField({ push_record_cap: Number(e3.target.value) }),
                  children: PUSH_CAP_OPTIONS.map((cap) =>
                    jsx('option', {
                      value: String(cap),
                      children: cap > 0 ? cap + ' 条' : '不限'
                    })
                  )
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '记录备份'
                }),
                jsx('div', {
                  style: {
                    display: 'flex',
                    gap: '6px',
                    flexWrap: 'wrap'
                  },
                  children: [
                    jsx('button', {
                      type: 'button',
                      style: {
                        padding: '4px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      },
                      onClick: () => queueRebuildPushRecords(),
                      children: ['从 Eagle 重建']
                    }),
                    jsx('button', {
                      type: 'button',
                      style: {
                        padding: '4px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      },
                      onClick: () => exportPushRecords(),
                      children: ['导出 JSON']
                    }),
                    jsx('button', {
                      type: 'button',
                      style: {
                        padding: '4px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      },
                      onClick: () => importPushRecords(),
                      children: ['导入 JSON']
                    })
                  ]
                })
              ]
            }),
            jsx('div', {
              className: configModalStyles.row,
              children: [
                jsx('span', {
                  className: configModalStyles.label,
                  children: '记录清理'
                }),
                jsx('button', {
                  type: 'button',
                  style: {
                    padding: '4px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  },
                  onClick: () => {
                    const total = PushHistory.count();
                    if (!total) {
                      alert('当前没有推送记录');
                      return;
                    }
                    if (!confirm('确定清空 ' + total + ' 条推送记录？清空后卡片与详情页的「已推送」标记会消失。'))
                      return;
                    PushHistory.clear().then(() => {
                      try {
                        document
                          .querySelectorAll('.dy-dl-feed-pushed, .dy-dl-video-pushed')
                          .forEach((el) => el.remove());
                      } catch (err) {}
                      alert('已清空推送记录');
                    });
                  },
                  children: ['清空推送记录（' + PushHistory.count() + ' 条）']
                })
              ]
            })
          ]
        }),
        dlType === 'eagle' &&
          jsx('fieldset', {
            className: configModalStyles.fieldset,
            children: [
              jsx('legend', {
                className: configModalStyles.legend,
                children: 'Eagle 素材库'
              }),
              renderEagleFields()
            ]
          }),
        dlType === 'browser' &&
          jsx('fieldset', {
            className: configModalStyles.fieldset,
            children: [
              jsx('legend', {
                className: configModalStyles.legend,
                children: '浏览器下载（图片转码压缩）'
              }),
              renderBrowserImageFields()
            ]
          }),
        dlType === 'abdm' &&
          jsx('fieldset', {
            className: configModalStyles.fieldset,
            children: [
              jsx('legend', {
                className: configModalStyles.legend,
                children: 'AB Download Manager'
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Domain'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.domain || '',
                    onChange: (e3) => setField('domain', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Port'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.port || '',
                    onChange: (e3) => setField('port', e3.target.value)
                  })
                ]
              }),
              renderDirFields()
            ]
          }),
        dlType === 'aria2' &&
          jsx('fieldset', {
            className: configModalStyles.fieldset,
            children: [
              jsx('legend', {
                className: configModalStyles.legend,
                children: 'Aria2'
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Domain'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.domain || 'http://localhost',
                    onChange: (e3) => setField('domain', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Port'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.port || '6800',
                    onChange: (e3) => setField('port', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Path'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.path || '/jsonrpc',
                    onChange: (e3) => setField('path', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Token'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.token || '',
                    onChange: (e3) => setField('token', e3.target.value)
                  })
                ]
              }),
              renderDirFields()
            ]
          }),
        dlType === 'idm' &&
          jsx('fieldset', {
            className: configModalStyles.fieldset,
            children: [
              jsx('legend', {
                className: configModalStyles.legend,
                children: 'IDM'
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'ID'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.id || '1',
                    onChange: (e3) => setField('id', e3.target.value)
                  })
                ]
              })
            ]
          }),
        dlType === 'bc' &&
          jsx('fieldset', {
            className: configModalStyles.fieldset,
            children: [
              jsx('legend', {
                className: configModalStyles.legend,
                children: 'BitComet'
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Domain'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.domain || 'http://localhost',
                    onChange: (e3) => setField('domain', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Port'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.port || '8080',
                    onChange: (e3) => setField('port', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Path'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.path || '/panel/task_add_httpftp_result',
                    onChange: (e3) => setField('path', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Auth Name'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    value: dcfg.authName || '',
                    onChange: (e3) => setField('authName', e3.target.value)
                  })
                ]
              }),
              jsx('div', {
                className: configModalStyles.row,
                children: [
                  jsx('span', {
                    className: configModalStyles.label,
                    children: 'Auth Pass'
                  }),
                  jsx('input', {
                    className: configModalStyles.input,
                    type: 'password',
                    value: dcfg.authPass || '',
                    onChange: (e3) => setField('authPass', e3.target.value)
                  })
                ]
              }),
              renderDirFields()
            ]
          }),
        jsx('div', {
          className: configModalStyles.hintText,
          children: '选择下载器后填写对应配置；浏览器下载不需要额外连接配置，但可使用上面的图片转码/压缩设置。'
        })
      ]
    });
  };
  HistoryTab = () => {
    const [hist, setHist] = useState([]);
    useEffect(() => {
      setHist(DownloadHistory.get());
    }, []);
    const clearHist = () => {
      if (!confirm('确认清空所有下载记录？')) return;
      DownloadHistory.clear();
      setHist([]);
    };
    return jsx('div', {
      children: [
        jsx('div', {
          className: configModalStyles.flexBetween,
          style: {
            marginBottom: theme.spacing.md
          },
          children: [
            jsx('span', {
              style: {
                fontWeight: 'bold',
                fontSize: theme.fontSize.sm
              },
              children: '下载记录（最多50条）'
            }),
            hist.length > 0 &&
              jsx('button', {
                className: configModalStyles.btnDanger,
                onClick: clearHist,
                children: '清空'
              })
          ]
        }),
        hist.length === 0
          ? jsx('div', {
              style: {
                textAlign: 'center',
                padding: theme.spacing.xl,
                color: theme.colors.textDim
              },
              children: '暂无下载记录'
            })
          : jsx('table', {
              className: configModalStyles.table,
              children: [
                jsx('thead', {
                  children: jsx('tr', {
                    children: [
                      jsx('th', {
                        className: configModalStyles.th,
                        children: '描述'
                      }),
                      jsx('th', {
                        className: configModalStyles.th,
                        children: '分享链接'
                      }),
                      jsx('th', {
                        className: configModalStyles.th,
                        children: '下载时间'
                      })
                    ]
                  })
                }),
                jsx('tbody', {
                  children: hist.map((h3, i3) =>
                    jsx(
                      'tr',
                      {
                        children: [
                          jsx('td', {
                            className: configModalStyles.td,
                            children: h3.desc || '(无描述)'
                          }),
                          jsx('td', {
                            className: configModalStyles.td,
                            children: h3.shareUrl
                              ? jsx('a', {
                                  href: h3.shareUrl,
                                  target: '_blank',
                                  rel: 'noopener noreferrer',
                                  style: {
                                    color: theme.colors.primary
                                  },
                                  children: '链接'
                                })
                              : '-'
                          }),
                          jsx('td', {
                            className: configModalStyles.td,
                            children: h3.downloadTime ? new Date(h3.downloadTime).toLocaleString() : '-'
                          })
                        ]
                      },
                      i3
                    )
                  )
                })
              ]
            })
      ]
    });
  };
  tabs2 = [
    {
      id: 'settings',
      title: '基本设置',
      Comp: SettingsTab
    },
    {
      id: 'downloader',
      title: '下载器配置',
      Comp: DownloaderConfigTab
    },
    {
      id: 'history',
      title: '下载历史',
      Comp: HistoryTab
    }
  ];
  ConfigModalApp = ({config, modal}) => {
    const [tab, setTab] = useState('settings');
    const [cfg, setCfg] = useState(() => config.clone_features());
    const [original, setOriginal] = useState(() => config.clone_features());
    const originalRef = T2(() => JSON.stringify(original), [original]);
    const dirty = T2(() => JSON.stringify(cfg) !== originalRef, [cfg, originalRef]);
    const dirtyRef = A2(false);
    dirtyRef.current = dirty;
    useEffect(() => {
      const refresh = () => {
        const latest = config.clone_features();
        if (dirtyRef.current) return;
        setCfg(latest);
        setOriginal(latest);
      };
      return config.events.on('config_change', refresh);
    }, [config]);
    useEffect(() => {
      if (modal) {
        modal.onBeforeClose = dirty ? () => confirm('有未保存的修改，确定放弃？') : void 0;
      }
    }, [dirty, modal]);
    const onSave = () => {
      const changedPaths = Config.diff_paths(original, cfg);
      const latest = config.clone_features();
      if (changedPaths.length === 0) {
        setOriginal(latest);
        setCfg(latest);
        alert('配置已保存');
        return;
      }
      const conflictingPaths = changedPaths.filter((path) => Config.diff_paths(original, latest).includes(path));
      if (
        conflictingPaths.length > 0 &&
        !confirm(`其他标签页已修改：${conflictingPaths.join('、')}。保存会覆盖这些字段，确定继续？`)
      )
        return;
      config.features = Config.apply_paths(latest, cfg, changedPaths);
      config.save();
      const saved = config.clone_features();
      setOriginal(saved);
      setCfg(saved);
      alert('配置已保存');
    };
    const onEdit = () =>
      setCfg({
        ...cfg
      });
    const onCancel = () => {
      const latest = config.clone_features();
      setCfg(latest);
      setOriginal(latest);
    };
    const onResetDefaults = () => {
      if (!confirm('确定重置为默认配置？此操作会覆盖当前所有配置，包括下载器、图片、文件命名等。')) return;
      setCfg(Config.default_features());
    };
    const t3 = tabs2.find((t4) => t4.id === tab);
    const props = (id) => {
      if (id === 'settings')
        return {
          cfg,
          onChange: onEdit,
          onResetDefaults
        };
      if (id === 'downloader')
        return {
          cfg,
          onChange: onEdit
        };
      return {};
    };
    const Comp = t3.Comp;
    return jsx('div', {
      className: configModalStyles.container,
      children: [
        jsx('div', {
          className: configModalStyles.header,
          children: [
            jsx('nav', {
              className: configModalStyles.nav,
              children: tabs2.map((t4) =>
                jsx(
                  'button',
                  {
                    onClick: () => setTab(t4.id),
                    className: navCls(tab === t4.id),
                    children: t4.title
                  },
                  t4.id
                )
              )
            }),
            dirty &&
              jsx('div', {
                className: configModalStyles.actions,
                children: [
                  jsx('button', {
                    className: configModalStyles.btnDanger,
                    onClick: onCancel,
                    children: '取消'
                  }),
                  jsx('button', {
                    className: configModalStyles.btnSaveDirty,
                    onClick: onSave,
                    children: '保存'
                  })
                ]
              })
          ]
        }),
        jsx('div', {
          className: configModalStyles.content,
          children: jsx(Comp, {
            ...props(tab)
          })
        })
      ]
    });
  };
  // ─── src/core/ImageProcessor.ts · 图片处理（缩放 / 转码 / 取原图） ──
  class ImageProcessor {
    constructor(config = {}) {
      this.resizeMap = {
        '2k_max': 2048,
        '1k_max': 1024,
        '960_max': 960,
        '640_max': 640,
        '512_max': 512
      };
      this.config = {
        image_convert_codecs: 'default',
        image_resize_codecs: 'default',
        image_quality: 80,
        ...config
      };
    }
    /**
     * 根据配置判断是否需要压缩转码
     */
    is_need_convert(width, height) {
      const {image_convert_codecs, image_resize_codecs} = this.config;
      const need_format = image_convert_codecs !== 'default';
      const resize_target = this.resizeMap[image_resize_codecs] ?? Infinity;
      const need_resize = width > resize_target || height > resize_target;
      return need_format || need_resize;
    }
    /**
     * 主入口
     */
    async process(file) {
      const bitmap = await createImageBitmap(file);
      let {width, height} = bitmap;
      if (!this.is_need_convert(width, height)) {
        return {
          blob: file
        };
      }
      ({width, height} = this._resize(width, height));
      const canvas = this._createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const outputType = this._getOutputType(file.type);
      if (outputType === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await this._toBlob(canvas, outputType);
      return {
        blob,
        outputType
      };
    }
    /**
     * resize 逻辑
     * @private
     */
    _resize(width, height) {
      const mode = this.config.image_resize_codecs;
      const maxEdge = this.resizeMap[mode];
      if (!maxEdge)
        return {
          width,
          height
        };
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      return {
        width: Math.round(width * scale),
        height: Math.round(height * scale)
      };
    }
    /**
     * canvas 创建（兼容 fallback）
     * @private
     */
    _createCanvas(width, height) {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    /**
     * 输出格式决策
     * @private
     */
    _getOutputType(inputType) {
      const codec = this.config.image_convert_codecs;
      if (codec === 'png') return 'image/png';
      if (codec === 'jpg') return 'image/jpeg';
      if (codec === 'webp') return 'image/webp';
      if (inputType === 'image/png') return 'image/png';
      if (inputType === 'image/webp') return 'image/webp';
      return 'image/jpeg';
    }
    /**
     * 质量归一化
     * @private
     */
    _normalizeQuality() {
      const q3 = this.config.image_quality;
      if (!q3) return 0.8;
      return Math.min(1, Math.max(0.1, q3 / 100));
    }
    /**
     * toBlob 封装（兼容 HTMLCanvas）
     * @private
     */
    _toBlob(canvas, type) {
      const quality = this._normalizeQuality();
      if (canvas.convertToBlob) {
        return canvas.convertToBlob({
          type,
          quality
        });
      }
      return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), type, quality);
      });
    }
  }
  // ─── src/core/eagle/EagleClient.ts · Eagle 本地 API 客户端 ──────────
  var _EagleClient, getEagleClient, eagleClientSingleton, EAGLE_DEFAULT_BASE_URL, EAGLE_API_MAP, EAGLE_MEDIA_HOSTS;
  EAGLE_DEFAULT_BASE_URL = 'http://127.0.0.1:41595';
  /**
   * 抖音 CDN 域名：这些域名才需要补 Referer / UA。
   */
  EAGLE_MEDIA_HOSTS = [
    'douyin.com',
    'douyinpic.com',
    'douyinvod.com',
    'douyincdn.com',
    'iesdouyin.com',
    'ixigua.com',
    'byteimg.com',
    'bytednsdoc.com',
    'snssdk.com',
    'pstatp.com',
    'zjcdn.com',
    'toutiaoimg.com'
  ];
  /**
   * 同一个逻辑操作在两种 Eagle API 风格下的路径与参数差异。
   *
   * v1 = Eagle 4.0 桌面版实际提供的接口（用 app.asar 里的路由表核对过）：
   *   添加素材   POST /api/item/addFromURL（收 folderIds 数组，且不返回素材 id）
   *   按 url 查  GET  /api/item/list?url=（子串匹配，需逐条复核）
   *   建文件夹   POST /api/folder/create（参数名是 folderName）
   * v2 = 较新版本提供的 /api/v2/*（保留兼容）。
   */
  EAGLE_API_MAP = {
    appInfo: {
      v2: {
        path: '/api/v2/app/info',
        method: 'GET'
      },
      v1: {
        path: '/api/application/info',
        method: 'GET'
      }
    },
    folderList: {
      v2: {
        path: '/api/v2/folder/get',
        method: 'GET',
        query: (p) => `?offset=${p.offset || 0}&limit=${p.limit || 200}`
      },
      v1: {
        path: '/api/folder/list',
        method: 'GET'
      }
    },
    folderCreate: {
      v2: {
        path: '/api/v2/folder/create',
        method: 'POST',
        body: (p) => ({
          name: p.name,
          parent: p.parent || void 0
        })
      },
      v1: {
        path: '/api/folder/create',
        method: 'POST',
        body: (p) => ({
          folderName: p.name,
          parent: p.parent || void 0
        })
      }
    },
    tagList: {
      v2: {
        path: '/api/v2/tag/get',
        method: 'GET',
        query: (p) => `?offset=${p.offset || 0}&limit=${p.limit || 50}`
      },
      v1: {
        path: '/api/tag/list',
        method: 'GET'
      }
    },
    itemLookupByUrl: {
      v2: {
        path: '/api/v2/item/get',
        method: 'GET',
        query: (p) => `?url=${encodeURIComponent(p.url)}&limit=${p.limit || 100}`
      },
      v1: {
        path: '/api/item/list',
        method: 'GET',
        query: (p) => `?url=${encodeURIComponent(p.url)}&limit=${p.limit || 100}`
      }
    },
    itemAdd: {
      v2: {
        path: '/api/v2/item/add',
        method: 'POST',
        body: (p) => ({
          url: p.url,
          name: p.name,
          website: p.website,
          tags: p.tags,
          annotation: p.annotation,
          folders: p.folders,
          headers: p.headers
        })
      },
      v1: {
        path: '/api/item/addFromURL',
        method: 'POST',
        body: (p) => ({
          url: p.url,
          name: p.name,
          website: p.website,
          tags: p.tags,
          annotation: p.annotation,
          folderIds: p.folders,
          headers: p.headers
        })
      }
    }
  };
  class EagleClient {
    constructor(options = {}) {
      const raw = String(options.baseURL || EAGLE_DEFAULT_BASE_URL).trim();
      this.baseURL = raw.replace(/\/+$/, '') || EAGLE_DEFAULT_BASE_URL;
      this.apiStyle = null;
      this.folderTree = null;
      this.tagNames = null;
      this.lookupCache = new Map();
    }
    static xmlHttpRequest(option) {
      const xhr =
        typeof GM_xmlhttpRequest === 'function'
          ? GM_xmlhttpRequest
          : typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function'
            ? GM.xmlHttpRequest
            : null;
      if (!xhr) throw new Error('GreaseMonkey 兼容 XMLHttpRequest 不可用，无法访问 Eagle API。');
      return xhr({
        withCredentials: false,
        ...option
      });
    }
    /**
     * 底层请求：统一补 baseURL、解析 JSON、把 Eagle 的错误包装成异常。
     */
    request(path, method, data) {
      return new Promise((resolve, reject) => {
        EagleClient.xmlHttpRequest({
          method: method || 'GET',
          url: this.baseURL + path,
          headers: {
            'Content-Type': 'application/json'
          },
          data: data ? JSON.stringify(data) : void 0,
          timeout: 8e3,
          onload: (res) => {
            let parsed = null;
            try {
              parsed = JSON.parse(res.responseText || '{}');
            } catch (err) {
              reject(new Error('Eagle 返回了无法解析的内容'));
              return;
            }
            if (!(res.status >= 200 && res.status < 300)) {
              reject(new Error(`Eagle HTTP ${res.status}`));
              return;
            }
            if (parsed && parsed.status && parsed.status !== 'success') {
              reject(
                new Error(parsed.message || (typeof parsed.data === 'string' ? parsed.data : '') || 'Eagle API 错误')
              );
              return;
            }
            resolve(parsed);
          },
          onerror: () => reject(new Error('Eagle API 请求失败（Eagle 未运行？）')),
          ontimeout: () => reject(new Error('Eagle API 请求超时'))
        });
      });
    }
    /**
     * 探测 Eagle 的 API 风格并缓存：v2 可用则用 v2，否则回退 v1。
     * 两种都失败说明 Eagle 没运行（或端口被占用）。
     */
    async getApiStyle(force = false) {
      if (this.apiStyle && !force) return this.apiStyle;
      let lastError = null;
      for (const style of ['v2', 'v1']) {
        const spec = EAGLE_API_MAP.appInfo[style];
        try {
          await this.request(spec.path, spec.method);
          this.apiStyle = style;
          return style;
        } catch (err) {
          lastError = err;
        }
      }
      this.apiStyle = null;
      throw lastError || new Error('Eagle API 不可用');
    }
    /**
     * 按逻辑操作名调用 Eagle API；命中 404/405 时自动换另一种风格重试一次。
     */
    async callApi(key, params = {}) {
      const style = await this.getApiStyle();
      const spec = EAGLE_API_MAP[key] && EAGLE_API_MAP[key][style];
      if (!spec) throw new Error(`当前 Eagle（${style}）不支持该操作：${key}`);
      const build = (target) => ({
        path: target.path + (typeof target.query === 'function' ? target.query(params) : ''),
        method: target.method,
        data: typeof target.body === 'function' ? target.body(params) : void 0
      });
      const call = build(spec);
      try {
        return await this.request(call.path, call.method, call.data);
      } catch (err) {
        const text = String((err && err.message) || err);
        if (text.includes('404') || text.includes('method not allowed')) {
          const other = style === 'v2' ? 'v1' : 'v2';
          const otherSpec = EAGLE_API_MAP[key] && EAGLE_API_MAP[key][other];
          if (otherSpec) {
            this.apiStyle = other;
            const retried = build(otherSpec);
            return await this.request(retried.path, retried.method, retried.data);
          }
        }
        throw err;
      }
    }
    static extractListData(response) {
      if (Array.isArray(response?.data?.data)) return response.data.data;
      if (Array.isArray(response?.data)) return response.data;
      return [];
    }
    /**
     * 拉取文件夹树（自动兼容 v2 的分页扁平结构）并缓存。
     */
    async getFolders(force = false) {
      if (!force && Array.isArray(this.folderTree)) return this.folderTree;
      const style = await this.getApiStyle();
      const all = [];
      if (style === 'v2') {
        const limit = 200;
        let offset = 0;
        let total = 0;
        do {
          const response = await this.callApi('folderList', {
            offset,
            limit
          });
          const page = EagleClient.extractListData(response);
          total = Number(response?.data?.total || page.length || 0);
          all.push(...page);
          offset += limit;
          if (page.length === 0) break;
        } while (offset < total);
      } else {
        const response = await this.callApi('folderList', {});
        all.push(...EagleClient.extractListData(response));
      }
      this.folderTree = EagleClient.buildFolderTree(all);
      return this.folderTree;
    }
    /**
     * 统一成 {id, name, children} 的嵌套结构：v1 本来就返回嵌套，
     * v2 可能是带 parent 的扁平列表。
     */
    static buildFolderTree(list) {
      const nodes = (Array.isArray(list) ? list : []).filter((node) => node && node.id);
      const nested = (node) => ({
        id: node.id,
        name: String(node.name || ''),
        children: (Array.isArray(node.children) ? node.children : []).filter((child) => child && child.id).map(nested)
      });
      if (nodes.some((node) => Array.isArray(node.children) && node.children.length > 0)) {
        return nodes.map(nested);
      }
      const map = new Map();
      nodes.forEach((node) =>
        map.set(node.id, {
          id: node.id,
          name: String(node.name || ''),
          children: []
        })
      );
      const roots = [];
      nodes.forEach((node) => {
        const self = map.get(node.id);
        const parentId = node.parent || node.parentId || '';
        if (parentId && map.has(parentId) && parentId !== node.id) map.get(parentId).children.push(self);
        else roots.push(self);
      });
      return roots;
    }
    /**
     * 拉取标签名列表（去重 + 拼音排序交给 UI 处理）。
     */
    async getTags(force = false) {
      if (!force && Array.isArray(this.tagNames)) return this.tagNames;
      const style = await this.getApiStyle();
      const raw = [];
      if (style === 'v2') {
        let offset = 0;
        let total = Infinity;
        do {
          const response = await this.callApi('tagList', {
            offset,
            limit: 50
          });
          const page = EagleClient.extractListData(response);
          raw.push(...page);
          total = Number(response?.data?.total || raw.length);
          offset += page.length;
          if (page.length === 0) break;
        } while (offset < total);
      } else {
        const response = await this.callApi('tagList', {});
        raw.push(...EagleClient.extractListData(response));
      }
      const names = new Set();
      raw.forEach((tag) => {
        const name = typeof tag === 'string' ? tag : tag?.name;
        if (name && String(name).trim()) names.add(String(name).trim());
      });
      this.tagNames = Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      return this.tagNames;
    }
    /**
     * 把文件夹 id 翻译成 “父级/子级” 形式的可读路径。
     */
    findFolderPath(folderId) {
      const target = String(folderId || '');
      if (!target) return '';
      const walk = (nodes, prefix) => {
        for (const node of Array.isArray(nodes) ? nodes : []) {
          const path = prefix ? `${prefix}/${node.name}` : node.name;
          if (node.id === target) return path;
          const found = walk(node.children, path);
          if (found) return found;
        }
        return '';
      };
      return walk(this.folderTree || [], '');
    }
    /** 在文件夹树里按 id 找节点 */
    static findFolderById(nodes, id) {
      const target = String(id || '');
      if (!target) return null;
      for (const node of Array.isArray(nodes) ? nodes : []) {
        if (node.id === target) return node;
        const found = EagleClient.findFolderById(node.children, target);
        if (found) return found;
      }
      return null;
    }
    /** 在给定层级里按名字找文件夹 */
    static findFolderByName(nodes, name) {
      const target = String(name || '').trim();
      if (!target) return null;
      for (const node of Array.isArray(nodes) ? nodes : []) {
        if (String(node.name || '').trim() === target) return node;
        const found = EagleClient.findFolderByName(node.children, target);
        if (found) return found;
      }
      return null;
    }
    /** 作者昵称 -> 安全的文件夹名（复用文件名清洗规则） */
    static safeFolderName(name) {
      const raw = String(name || '').trim();
      if (!raw) return '';
      return normalizePathSegment(raw, {
        maxLength: 60
      });
    }
    /**
     * 新建文件夹，并把新节点挂进已缓存的文件夹树（避免批量推送时反复全量拉取）。
     */
    async createFolder(name, parentId = '') {
      const safe = String(name || '').trim();
      if (!safe) return '';
      const response = await this.callApi('folderCreate', {
        name: safe,
        parent: parentId || ''
      });
      const id = String(response?.data?.id || '');
      if (!id) return '';
      if (Array.isArray(this.folderTree)) {
        const node = {
          id,
          name: safe,
          children: []
        };
        const parentNode = parentId ? EagleClient.findFolderById(this.folderTree, parentId) : null;
        if (parentNode) parentNode.children.push(node);
        else if (!parentId) this.folderTree.push(node);
        else this.folderTree = null;
      }
      return id;
    }
    /**
     * 解析「作者名」对应的文件夹 id：优先用已有同名文件夹，没有就在
     * parentId（通常是设置里的目标文件夹）下创建；返回空串表示无法定位。
     */
    async resolveAuthorFolder(authorName, parentId = '') {
      const safe = EagleClient.safeFolderName(authorName);
      if (!safe) return '';
      const tree = await this.getFolders();
      const parentNode = parentId ? EagleClient.findFolderById(tree, parentId) : null;
      const scope = parentNode ? parentNode.children : tree;
      const found = EagleClient.findFolderByName(scope, safe);
      if (found && found.id) return found.id;
      return await this.createFolder(safe, parentId);
    }
    normalizeUrl(url) {
      return String(url || '')
        .trim()
        .replace(/[?#].*$/, '');
    }
    /**
     * Eagle 落库时会剥掉扩展名（扩展名单独存在 item.ext），
     * 而脚本给出的 task.name 可能带扩展名，所以比较前先规范化。
     */
    static isSameItemName(a, b) {
      const left = String(a || '').trim();
      const right = String(b || '').trim();
      if (!left || !right) return false;
      if (left === right) return true;
      return left.replace(/\.[a-z0-9]{1,5}$/i, '') === right.replace(/\.[a-z0-9]{1,5}$/i, '');
    }
    /**
     * 判断素材是否已经在 Eagle 里：
     * 按来源页面 URL 查询（v1 是子串匹配，必须再逐条复核 URL 与文件名）。
     */
    async findExisting(task) {
      const website = String(task?.website || '').trim();
      if (!website) return false;
      const cacheKey = this.normalizeUrl(website) || website;
      let items = this.lookupCache.get(cacheKey);
      if (!items) {
        const response = await this.callApi('itemLookupByUrl', {
          url: website,
          limit: 100
        });
        items = EagleClient.extractListData(response);
        this.lookupCache.set(cacheKey, items);
      }
      const targetUrl = this.normalizeUrl(website);
      return items.some((item) => {
        if (this.normalizeUrl(item?.url || '') !== targetUrl) return false;
        return EagleClient.isSameItemName(item?.name, task?.name);
      });
    }

    /**
     * 把一条媒体直链交给 Eagle 下载入库。
     */
    async addFromURL(task) {
      return this.callApi('itemAdd', {
        url: task.url,
        name: task.name,
        website: task.website,
        tags: Array.isArray(task.tags) ? task.tags : [],
        annotation: task.annotation || '',
        folders: Array.isArray(task.folders) ? task.folders.filter(Boolean) : [],
        headers: task.headers
      });
    }
    /**
     * 抖音 CDN 对缺少来源头的下载请求可能直接拒绝，
     * 给这些域名补上页面级 Referer 与浏览器 UA。
     */
    static buildDownloadHeaders(rawUrl, userAgent) {
      const url = String(rawUrl || '').trim();
      if (!/^https?:\/\//i.test(url)) return void 0;
      let host = '';
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch (err) {
        return void 0;
      }
      const matched = EAGLE_MEDIA_HOSTS.some((suffix) => host === suffix || host.endsWith('.' + suffix));
      if (!matched) return void 0;
      const headers = {
        Referer: 'https://www.douyin.com/'
      };
      const ua = userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
      if (ua) headers['User-Agent'] = ua;
      return headers;
    }
  }
  /**
   * 按 baseURL 复用单例，避免每次推送都重新探测 API 风格。
   */
  getEagleClient = (options = {}) => {
    const raw = String(options.baseURL || EAGLE_DEFAULT_BASE_URL).trim();
    const baseURL = raw.replace(/\/+$/, '') || EAGLE_DEFAULT_BASE_URL;
    if (!eagleClientSingleton || eagleClientSingleton.baseURL !== baseURL) {
      eagleClientSingleton = new EagleClient({
        baseURL
      });
    }
    return eagleClientSingleton;
  };
  function parseMimeType(contentType) {
    return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  }
  function sanitizeFileExtension(ext) {
    return ext.match(/[a-z0-9]+/i)?.[0].toLowerCase() ?? '';
  }
  // ─── src/core/download/Downloader.ts · 下载器（分流各平台） ─────────
  class Downloader {
    /**
     * 将 WebP 图片转换为 PNG 格式
     */
    async convertWebPToPNG(blob) {
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });
    }
    /**
     * 获取请求头
     */
    async get_headers(url) {
      try {
        const response = await fetch(url, {
          method: 'HEAD'
        });
        if (!response.ok) return new Headers();
        return response.headers;
      } catch {
        return new Headers();
      }
    }
    /**
     * 根据请求头猜测完整文件名
     */
    async prepare_filename(dl_url, filename_input = '', options = {}) {
      let url = dl_url;
      if (url.startsWith('//')) {
        url = window.location.protocol + url;
      }
      const headers = options.mediaType === 'video' ? new Headers() : await this.get_headers(url);
      const content_disposition = headers.get('content-disposition') || '';
      const content_type = headers.get('content-type') || '';
      const content_length = headers.get('content-length') || '';
      const imagex_fmt = headers.get('Imagex-Fmt') || '';
      const mimeType = parseMimeType(content_type);
      const imagexFmt = imagex_fmt.toLowerCase();
      const isWebP = imagexFmt.includes('webp') || url.toLowerCase().includes('.webp') || mimeType.includes('webp');
      const isImage =
        options.mediaType === 'image' ||
        (options.mediaType !== 'video' && (!!imagex_fmt || mimeType.startsWith('image/') || isWebP));
      const isVideo = options.mediaType === 'video' || mimeType.startsWith('video/');
      let fileExtGuess = mimeType.split('/')[1]?.toLowerCase();
      if (isWebP) fileExtGuess = 'webp';
      else if (imagexFmt.includes('png')) fileExtGuess = 'png';
      else if (imagexFmt.includes('jpeg') || imagexFmt.includes('jpg')) fileExtGuess = 'jpg';
      if (!fileExtGuess && isImage) fileExtGuess = 'jpg';
      else if (!fileExtGuess) fileExtGuess = 'bin';
      let determinedFileExt = sanitizeFileExtension(fileExtGuess);
      if (options.mediaType === 'video') {
        determinedFileExt = 'mp4';
      } else if (content_disposition) {
        const m3 = content_disposition.match(/filename="(.+)"$/i);
        if (m3) {
          const fe = sanitizeFileExtension(m3[1].split('.').pop() ?? '');
          if (fe) determinedFileExt = fe;
        }
      }
      let filename = normalizeFilename(filename_input || new URL(url).pathname.split('/').pop() || 'download');
      if (filename.endsWith('.image')) filename = filename.slice(0, -'.image'.length);
      filename = normalizeFilename(filename);
      let filename_base = normalizeBasename(filename.replace(/\.[^/.]+$/, ''));
      const re = new RegExp('\\.' + determinedFileExt + '$', 'i');
      if (!re.test(filename)) filename = normalizeFilename(filename_base + '.' + determinedFileExt);
      filename = normalizeFilename(filename);
      filename_base = normalizeBasename(filename.replace(/\.[^/.]+$/, ''));
      return {
        filename,
        ext: determinedFileExt,
        isImage,
        isVideo,
        isWebP,
        headers,
        content_length,
        content_type,
        filename_base
      };
    }
    /**
     * 预下载文件
     *
     * PS: 这一步其实没有下载，而是通过浏览器的缓存读取了
     * PSS: 并且如果浏览器没有缓存，似乎会报错，因为server那边会校验cookie，我们没带上
     */
    async prepare_download_file(dl_url, filename_input = '', options = {}) {
      const meta = await this.prepare_filename(dl_url, filename_input, options);
      const response = await fetch(dl_url);
      if (!response.ok) {
        return {
          ok: false,
          error_msg: 'Failed to fetch the file: ' + response.status
        };
      }
      const blob = await response.blob();
      return {
        blob,
        filename: meta.filename,
        filename_base: meta.filename_base,
        isImage: meta.isImage,
        isWebP: meta.isWebP,
        content_type: meta.content_type,
        fileExt: meta.ext,
        ok: true
      };
    }
    /**
     * 使用浏览器下载 Blob
     */
    async download_blob(blob, filename) {
      const link = document.createElement('a');
      link.style.display = 'none';
      link.download = normalizeFilename(filename);
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }
    /**
     * 下载后处理：转码、压缩图片
     */
    async download_postprocess(blob, content_type, options = {}) {
      const looksLikeImage =
        parseMimeType(content_type).startsWith('image/') ||
        blob.type.startsWith('image/') ||
        options.isImage ||
        options.isWebP;
      if (looksLikeImage) {
        const processor = new ImageProcessor(Config.global.clone_features());
        return processor.process(blob);
      }
      return {
        blob
      };
    }
    /**
     * 使用浏览器下载数据
     *
     * 下载文件流程:
     * 1. 预下载为 blob，读取元信息
     * 2. 如果是 webp 图片，尝试转为 png 图片
     * 3. 下载 blob
     */
    async download_using_browser(url, filename_input, options = {}) {
      let blob;
      let filename;
      try {
        const result = await this.prepare_download_file(url, filename_input, options);
        if (!result.ok)
          return {
            ok: false,
            error_msg: result.error_msg || '预下载失败'
          };
        filename = result.filename;
        blob = result.blob;
        const {blob: new_blob, outputType} = await this.download_postprocess(blob, result.content_type ?? '', {
          isImage: result.isImage,
          isWebP: result.isWebP
        });
        blob = new_blob;
        if (outputType === 'image/png') filename = result.filename_base + '.png';
        else if (outputType === 'image/jpeg') filename = result.filename_base + '.jpeg';
        else if (outputType === 'image/webp') filename = result.filename_base + '.webp';
      } catch (error) {
        console.error('[dy-dl]预下载异常', error);
        return {
          ok: false,
          error_msg: '预下载异常'
        };
      }
      if (blob && filename) {
        try {
          await this.download_blob(blob, filename);
          return {
            ok: true,
            error_msg: ''
          };
        } catch (error) {
          console.error('[dy-dl]下载blob失败', error);
          return {
            ok: false,
            error_msg: '下载失败'
          };
        }
      }
      return {
        ok: false,
        error_msg: '下载失败'
      };
    }
    /**
     * 根据配置使用不同的下载器
     */
    async download_one_url(url, filename_input, options = {}) {
      const {using_downloader, downloader_config} = Config.global.features;
      const activeDownloader = options.downloaderOverride || using_downloader;
      switch (activeDownloader) {
        case 'eagle':
          return this.eagle_push(url, filename_input, options);
        case 'browser':
          return this.download_using_browser(url, filename_input, options);
        case 'idm':
        case 'aria2':
        case 'bc':
        case 'abdm': {
          let resolvedFilename = filename_input;
          try {
            const meta = await this.prepare_filename(url, filename_input, options);
            resolvedFilename = meta.filename;
          } catch (err) {
            console.warn('[dy-dl] prepare_filename failed, using input filename', err);
          }
          const launcher = new DownloaderLauncher({
            idmList: [
              {
                id: downloader_config.idm?.id || '1'
              }
            ],
            aria2List: [
              {
                domain: downloader_config.aria2?.domain || 'http://localhost',
                port: downloader_config.aria2?.port || '6800',
                path: downloader_config.aria2?.path || '/jsonrpc',
                token: downloader_config.aria2?.token ?? '',
                dir: ''
              }
            ],
            bitcometList: [
              {
                domain: downloader_config.bc?.domain || 'http://localhost',
                port: downloader_config.bc?.port || '8080',
                path: downloader_config.bc?.path || '/panel/task_add_httpftp_result',
                authName: downloader_config.bc?.authName ?? '',
                authPass: downloader_config.bc?.authPass ?? '',
                dir: ''
              }
            ],
            abdmList: [
              {
                domain: downloader_config.abdm?.domain || 'http://localhost',
                port: downloader_config.abdm?.port || '15151',
                dir: ''
              }
            ]
          });
          const ok = await launcher.invoke_download(url, activeDownloader, downloader_config[activeDownloader]?.dir, {
            filename_input: resolvedFilename,
            media: options.media,
            mediaType: options.mediaType
          });
          return {
            ok: !!ok,
            error_msg: ''
          };
        }
        default:
          return {
            ok: false,
            error_msg: '未知下载器'
          };
      }
    }
    /**
     * 推送到 Eagle
     *
     * Eagle 会自己异步拉取媒体直链，所以这里只负责：
     * 1. 从候选地址里挑一个对 Eagle 最友好的（带签名的 CDN 直链优先，
     *    因为 Eagle 是外部程序、没有浏览器的 cookie，同源 playApi 只作兜底）；
     * 2. 组装 name / website / tags / annotation；
     * 3. 可选地先查重再入库。
     *
     * tags 为空表示不添加任何标签（配置里未选择标签时的默认行为）。
     */
    async eagle_push(url, filename_input, options = {}) {
      const config = Config.global.features.downloader_config?.eagle || {};
      const media = options.media;
      const client = getEagleClient({
        baseURL: config.base_url
      });
      const name = normalizeBasename(filename_input || urlFilenameFallback(url));
      const website = Downloader.buildMediaWebsite(media);
      const preferredUrl = Downloader.pickEagleFriendlyUrl(options.candidateUrls, url);
      const tags = Array.isArray(config.tags) ? config.tags.filter(Boolean) : [];
      const authorName = String(media?.authorInfo?.nickname || '').trim();
      if (config.author_as_tag && authorName && !tags.includes(authorName)) tags.push(authorName);
      let folders = config.folder_id ? [config.folder_id] : [];
      if (config.author_as_folder && authorName) {
        try {
          const authorFolderId = await client.resolveAuthorFolder(authorName, config.folder_id || '');
          if (authorFolderId) folders = [authorFolderId];
        } catch (err) {
          console.warn('[dy-dl] 作者文件夹定位失败，回退到原目标文件夹', err);
        }
      }
      const annotation = Downloader.buildEagleAnnotation(media, {
        website,
        mediaType: options.mediaType
      });
      try {
        if (config.skip_existing) {
          const exists = await client.findExisting({
            name,
            website
          });
          if (exists) {
            await PushHistory.record(media, options.mediaType, {
              config,
              name,
              website,
              folders,
              tags,
              fromEagle: true,
              batchId: options._dyBatchId
            });
            return {
              ok: true,
              error_msg: '',
              skipped: true
            };
          }
        }
        await client.addFromURL({
          url: preferredUrl,
          name,
          website,
          tags,
          folders,
          annotation,
          headers: config.send_referer ? EagleClient.buildDownloadHeaders(preferredUrl) : void 0
        });
        await PushHistory.record(media, options.mediaType, {
          config,
          name,
          website,
          folders,
          tags,
          fromEagle: false,
          batchId: options._dyBatchId
        });
        try {
          if (
            typeof domPatcher !== 'undefined' &&
            domPatcher &&
            typeof domPatcher.refreshPushedBadgeFor === 'function'
          ) {
            domPatcher.refreshPushedBadgeFor(media && media.awemeId);
          }
        } catch (err) {}
        return {
          ok: true,
          error_msg: ''
        };
      } catch (err) {
        console.warn('[dy-dl] Eagle 推送失败', err);
        return {
          ok: false,
          error_msg: `Eagle 推送失败：${err?.message || err}`
        };
      }
    }
    /** 作品在抖音的规范页面地址（用于 Eagle 的来源 URL / 去重） */
    static buildMediaWebsite(media) {
      const awemeId = media?.awemeId;
      if (!awemeId) return media?.shareInfo?.shareUrl || '';
      const isAlbum = Array.isArray(media?.images) && media.images.length > 0;
      return `https://www.douyin.com/${isAlbum ? 'note' : 'video'}/${awemeId}`;
    }
    /**
     * 收集图片的「原图」候选地址。
     *
     * 抖音前端模型里原图字段的命名在不同版本/入口下可能不同，这里把常见的几种都兜住；
     * 一个都拿不到时返回空数组，调用方会回退到 urlList / downloadUrlList。
     */
    static collectOriginUrls(item) {
      const out = [];
      const push = (v) => {
        if (!v) return;
        if (typeof v === 'string') {
          out.push(v);
          return;
        }
        if (Array.isArray(v)) {
          v.forEach(push);
          return;
        }
        if (typeof v === 'object') {
          push(v.urlList || v.url_list);
          push(v.url || v.src);
        }
      };
      if (item) {
        push(item.originUrl);
        push(item.origin_url);
        push(item.originUrlList);
        push(item.originalUrl);
        push(item.original_url);
      }
      return Array.from(new Set(out.filter(Boolean)));
    }
    /** 从候选地址里挑对 Eagle 最友好的一个 */
    static pickEagleFriendlyUrl(candidates, fallback) {
      const list = (Array.isArray(candidates) ? candidates : []).filter((u) => typeof u === 'string' && u.length > 0);
      const score = (u) => {
        const s = u.toLowerCase();
        if (/douyinvod\.com|zjcdn|\.mp4(\?|$)/.test(s)) return 0;
        if (/aweme\/v1\/play\//.test(s)) return 2;
        return 1;
      };
      const best = list.slice().sort((a, b) => score(a) - score(b))[0];
      return best || fallback;
    }
    /** 组装写进 Eagle 素材的说明文本 */
    static buildEagleAnnotation(media, meta = {}) {
      const lines = [];
      const desc = String(media?.desc || '').trim();
      if (desc) lines.push(desc);
      const nickname = media?.authorInfo?.nickname || '';
      const uid = media?.authorInfo?.uid || media?.authorUserId || '';
      if (nickname) lines.push(`作者: ${nickname}${uid ? ` (${uid})` : ''}`);
      const createTime = Number(media?.createTime) || 0;
      if (createTime > 0) {
        const date = new Date(createTime * 1e3);
        if (!Number.isNaN(date.getTime())) {
          const pad = (n) => String(n).padStart(2, '0');
          lines.push(`发布: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
        }
      }
      if (meta.website) lines.push(meta.website);
      if (media?.awemeId)
        lines.push(`[dy-dl] aweme:${media.awemeId}${meta.mediaType ? ` type:${meta.mediaType}` : ''}`);
      return lines.filter(Boolean).join('\n');
    }
    /**
     * 下载文件，根据所有 url 逐一尝试下载
     */
    async download_file_with_error(source, filename_input = '', fallback_src = [], options = {}) {
      let url_sources = [source, ...fallback_src].filter((x2) => typeof x2 === 'string' && x2.length > 0);
      url_sources = Array.from(new Set(url_sources));
      const attemptOptions = {
        ...options,
        candidateUrls: url_sources
      };
      let error_msg = '';
      for (const url of url_sources) {
        const r3 = await this.download_one_url(url, filename_input, attemptOptions);
        error_msg = error_msg || r3.error_msg;
        if (r3.ok)
          return {
            ok: true,
            error_msg: '',
            skipped: !!r3.skipped
          };
      }
      if (!options.silent) {
        alert(error_msg && url_sources.length === 1 ? error_msg : '[dy-dl]所有尝试下载都失败，请刷新重试');
      }
      return {
        ok: false,
        error_msg
      };
    }
    async download_file(source, filename_input = '', fallback_src = [], options = {}) {
      return (await this.download_file_with_error(source, filename_input, fallback_src, options)).ok;
    }
  }
  function renderHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.children[0];
  }
  // ─── src/ui/TooltipsButton.ts · 悬浮提示按钮 ────────────────────────
  class TooltipsButton {
    constructor(label, items, onclick, playerControlMode = 'douyin') {
      this.label = label;
      this.items = items;
      this.onclick = onclick;
      this.playerControlMode = playerControlMode;
    }
    render() {
      const rootTag = this.playerControlMode === 'xgplayer' ? 'xg-icon' : 'dy-icon';
      const settingClass =
        this.playerControlMode === 'xgplayer' ? 'xgplayer-playclarity-setting' : 'douyin-player-playclarity-setting';
      const htmlStr =
        '<' +
        rootTag +
        '  class="' +
        settingClass +
        ' dy-dl-video-btn"  data-state="normal"  data-index="11">  <div class="gear isSmoothSwitchClarityLogin">    <div class="virtual"></div>    <div class="btn" tabindex="0">' +
        this.label +
        '</div>  </div></' +
        rootTag +
        '>';
      const root = renderHtml(htmlStr);
      const $gear = root.querySelector('.gear');
      const $items_list = root.querySelector('.virtual');
      const $btn = root.querySelector('.btn');
      $gear.addEventListener('mouseenter', () => $gear.classList.add('hover'));
      $gear.addEventListener('mouseleave', () => $gear.classList.remove('hover'));
      for (const item of this.items) {
        if (item.html) {
          $items_list.appendChild(renderHtml(item.html));
          continue;
        }
        if (item.render) {
          $items_list.appendChild(item.render());
          continue;
        }
        const $item = renderHtml('<div class="item">' + item.label + '</div>');
        $item.addEventListener('click', item.callback);
        $items_list.appendChild($item);
      }
      $btn.addEventListener('click', this.onclick);
      return root;
    }
  }
  // ─── src/core/ProfileDataService.ts · 作者主页作品数据 ──────────────
  class ProfileDataService {
    constructor() {
      this.feedMediaCache = new Map();
    }
    static findReactFiber(node) {
      let current = node;
      while (current) {
        const fiberKey = Object.keys(current).find((key) => key.startsWith('__reactFiber$'));
        if (fiberKey) return current[fiberKey];
        current = current.parentElement;
      }
      return null;
    }
    static getAwemeIdFromHref(href = '') {
      const match = href.match(/\/(?:video|note)\/(\d+)/);
      return match?.[1] || '';
    }
    _extractFeedMedia(card) {
      let fiber = ProfileDataService.findReactFiber(card);
      while (fiber) {
        const props = fiber.memoizedProps;
        const candidate =
          props?.awemeInfo || props?.itemInfo?.awemeInfo || (props?.itemInfo?.awemeId ? props.itemInfo : null);
        if (candidate?.awemeId) {
          this.feedMediaCache.set(candidate.awemeId, candidate);
          return candidate;
        }
        fiber = fiber.return;
      }
      const awemeId = ProfileDataService.getAwemeIdFromHref(card.getAttribute('href') || '');
      return awemeId ? this.feedMediaCache.get(awemeId) || null : null;
    }
    collectCurrentFeedMedia() {
      const medias = [];
      const seen = new Set();
      document.querySelectorAll(ProfileDataService.FEED_CARD_SELECTOR).forEach((card) => {
        const media = this._extractFeedMedia(card);
        if (!media?.awemeId || seen.has(media.awemeId)) return;
        seen.add(media.awemeId);
        this.feedMediaCache.set(media.awemeId, media);
        medias.push(media);
      });
      return medias;
    }
    isProfilePage() {
      return isProfilePagePath();
    }
    getProfileContext() {
      if (!this.isProfilePage()) return null;
      const pathSecUid = location.pathname.replace(/^\/user\//, '').trim();
      const scannedMedia = this.collectCurrentFeedMedia().find((m3) => m3?.authorInfo?.secUid);
      const secUid =
        pathSecUid && pathSecUid !== 'self' ? pathSecUid : scannedMedia?.authorInfo?.secUid || pathSecUid || '';
      const titleName = document.title.split('的抖音')[0]?.trim() || '';
      const profileName = scannedMedia?.authorInfo?.nickname || titleName;
      const activeTab = new URLSearchParams(location.search).get('showTab') || 'post';
      const profileKey = secUid || 'self:' + activeTab;
      return {
        secUid,
        profileName,
        tabKey: activeTab,
        profileKey
      };
    }
    _findScrollContainer() {
      const firstCard = document.querySelector(ProfileDataService.FEED_CARD_SELECTOR);
      let current = firstCard instanceof HTMLElement ? firstCard.parentElement : null;
      while (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        const isScrollable =
          ['auto', 'scroll', 'overlay'].includes(style.overflowY) && current.scrollHeight > current.clientHeight + 100;
        if (isScrollable) return current;
        current = current.parentElement;
      }
      return (
        document.querySelector('.route-scroll-container') ||
        document.querySelector('.parent-route-container') ||
        document.scrollingElement ||
        document.documentElement
      );
    }
    async scrollPageOnce() {
      const container = this._findScrollContainer();
      if (!container) return false;
      const isDoc =
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;
      const beforeTop = isDoc ? window.scrollY : container.scrollTop;
      const clientHeight = isDoc ? window.innerHeight : container.clientHeight;
      const scrollHeight = container.scrollHeight;
      const maxTop = Math.max(0, scrollHeight - clientHeight);
      const nextTop = Math.min(beforeTop + Math.max(clientHeight * 0.85, 480), maxTop);
      if (nextTop <= beforeTop + 4) return false;
      if (isDoc)
        window.scrollTo({
          top: nextTop,
          behavior: 'smooth'
        });
      else
        container.scrollTo({
          top: nextTop,
          behavior: 'smooth'
        });
      await new Promise((r3) => setTimeout(r3, 1200));
      return true;
    }
  }
  ProfileDataService.FEED_CARD_SELECTOR =
    '.waterfall-videoCardContainer[href], [href*="/video/"][target="_blank"], [href*="/note/"][target="_blank"]';
  var FEED_STATUS_STYLES = {
    running: {
      background: '#2b2b2d',
      border: '1px solid #ffb74d',
      color: '#ffd79a'
    },
    downloaded: {
      background: '#2b2b2d',
      border: '1px solid #66bb6a',
      color: '#a5d6a7'
    },
    failed: {
      background: '#2b2b2d',
      border: '1px solid #ef5350',
      color: '#ef9a9a'
    },
    pending: {
      background: '#2b2b2d',
      border: '1px solid rgba(255,255,255,0.35)',
      color: '#fff'
    }
  };
  function formatFeedFileSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return value.toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
  }
  function formatFeedDuration(duration) {
    if (!duration || duration <= 0) return '';
    const totalSeconds = Math.max(1, Math.round(duration >= 1e3 ? duration / 1e3 : duration));
    const h3 = Math.floor(totalSeconds / 3600);
    const m3 = Math.floor((totalSeconds % 3600) / 60);
    const s5 = totalSeconds % 60;
    return h3 > 0
      ? `${h3}:${String(m3).padStart(2, '0')}:${String(s5).padStart(2, '0')}`
      : `${String(m3).padStart(2, '0')}:${String(s5).padStart(2, '0')}`;
  }
  function applyFeedStatusStyle(el, tone) {
    const style = FEED_STATUS_STYLES[tone];
    el.style.background = style.background;
    el.style.border = style.border;
    el.style.color = style.color;
  }
  function getFeedMetaLines(media) {
    if (!media) return [];
    if (Array.isArray(media.images) && media.images.length > 0) return ['🖼️ 图集', `图片数: ${media.images.length}张`];
    const video = media.video;
    if (!video) return [];
    const candidates = (video.bitRateList || []).filter(
      (item) => item?.format !== 'dash' && (item.dataSize || item.width || item.height)
    );
    const best = candidates.slice().sort((a3, b) => (b.dataSize || 0) - (a3.dataSize || 0))[0] || video;
    const width = best.width || video.width;
    const height = best.height || video.height;
    const size = formatFeedFileSize(best.dataSize || video.dataSize);
    const duration = formatFeedDuration(video.duration);
    const lines = ['🎬 视频'];
    if (width && height) lines.push(`分辨率: ${width}x${height}`);
    if (size) lines.push(`最大大小: ${size}`);
    if (duration) lines.push(`时长: ${duration}`);
    return lines;
  }
  // ─── src/ui/DOMPatcher.ts · 播放器 DOM 注入点修补 ──────────────────
  var PLAYER_CONTROL_SELECTOR = '.douyin-player-controls, xg-controls';
  var PLAYER_RIGHT_GRID_SELECTOR = '.douyin-player-controls-right, .xg-right-grid';
  var PLAYER_CONTROL_TREE_SELECTOR = `${PLAYER_CONTROL_SELECTOR}, ${PLAYER_RIGHT_GRID_SELECTOR}`;
  class DOMPatcher {
    /**
     * @param options - 包含各处理器实例的配置对象
     */
    constructor(options) {
      this.playerControlSyncPending = false;
      this.feed_card_selector_cls = 'dy-dl-feed-selector';
      this.downloader = options.downloader;
      this.mediaHandler = options.mediaHandler;
      this.videoHandler = options.videoHandler;
      this.danmakuHandler = options.danmakuHandler;
      this.profilePageHandler = options.profilePageHandler;
      this.observer = new MutationObserver(this._handleMutations.bind(this));
      Config.global.events.on('config_change', this._on_config_change.bind(this));
    }
    /**
     * 渲染 HTML 字符串为 DOM 元素
     */
    static render_html(html) {
      const div = document.createElement('div');
      div.innerHTML = html.trim();
      return div.children[0];
    }
    /** 从节点向上遍历 DOM 树查找 img 元素 */
    static findImage(node) {
      let img;
      let current = node;
      while (current) {
        img = current.querySelector('img');
        if (img) return img;
        current = current.parentElement instanceof HTMLElement ? current.parentElement : null;
      }
      return null;
    }
    /** 配置变更时同步卡片选择器和快捷键提示 */
    _on_config_change() {
      this._sync_shortcut_labels();
      this._sync_feed_cards();
    }
    /** 同步播放器菜单中的快捷键提示 */
    _sync_shortcut_labels() {
      const label = this._shortcut_label();
      document.body.querySelectorAll('.dy-dl-video-btn .shortcutKey').forEach((el) => {
        el.textContent = label;
      });
    }
    /** 当前下载快捷键展示文本 */
    _shortcut_label() {
      const features = Config.global.features;
      if (!features.enable_download_shortcut) return '已禁用';
      return features.download_shortcut?.trim() || '未设置';
    }
    /** 同步所有 feed 卡片的选择器状态 */
    _sync_feed_cards() {
      document.body
        .querySelectorAll(ProfileDataService.FEED_CARD_SELECTOR)
        .forEach((card) => this._handleProfileCard(card));
    }
    /** 处理 DOM 变更 */
    _handleMutations(mutations) {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node;
          if (el.classList.contains('semi-portal')) {
            const tn = el.querySelector('.semi-tooltip-wrapper');
            if (tn) {
              setTimeout(() => this._handleTooltip(tn));
              return;
            }
          }
          if (el.parentElement === document.body && el.classList.length === 0) {
            setTimeout(() => this._handleModal(el));
            return;
          }
          if (this._isPlayerControlNode(el)) {
            this._schedulePlayerControlSync();
            return;
          }
          if (el.matches(ProfileDataService.FEED_CARD_SELECTOR)) {
            this._handleProfileCard(el);
            return;
          }
          if (el.localName === 'li') {
            Array.from(el.querySelectorAll(ProfileDataService.FEED_CARD_SELECTOR)).forEach((dom) =>
              this._handleProfileCard(dom)
            );
          }
        });
      });
    }
    _isPlayerControlNode(node) {
      return (
        node.matches(PLAYER_CONTROL_TREE_SELECTOR) ||
        Boolean(node.querySelector(PLAYER_CONTROL_TREE_SELECTOR)) ||
        Boolean(node.closest(PLAYER_CONTROL_TREE_SELECTOR))
      );
    }
    _schedulePlayerControlSync() {
      if (this.playerControlSyncPending) return;
      this.playerControlSyncPending = true;
      setTimeout(() => {
        this.playerControlSyncPending = false;
        this._sync_player_controls();
      }, 80);
    }
    _sync_player_controls() {
      document.body.querySelectorAll(PLAYER_RIGHT_GRID_SELECTOR).forEach((grid) => this._handleXgControl(grid));
    }
    /** 处理模态框，注入图片下载按钮 */
    _handleModal(modalNode) {
      const close_icon = modalNode.querySelector('#svg_icon_ic_close');
      const img = modalNode.querySelector('img');
      const container = img?.closest(`div[style*="transform: scale(1)"] > div`) || img?.parentElement;
      if (!close_icon || !img || !container) return;
      if (container.querySelector('.dy-dl-modal-btn')) return;
      const btn = document.createElement('div');
      btn.textContent = '下载图片';
      btn.className = 'LV01TNDE dy-dl-modal-btn';
      btn.addEventListener('click', (e3) => {
        e3.stopPropagation();
        this.downloader.download_file(img.src, 'douyin_image');
      });
      Object.assign(btn.style, {
        position: 'absolute',
        bottom: '35px',
        right: '35px',
        color: '#fff',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '5px 10px',
        borderRadius: '4px',
        fontSize: '16px',
        zIndex: '999999',
        cursor: 'pointer'
      });
      container.appendChild(btn);
    }
    /** 处理 Tooltip，注入表情下载按钮 */
    _handleTooltip(tooltipNode) {
      const tc = tooltipNode.querySelector('.semi-tooltip-content');
      if (!tc || !tc.textContent?.includes('添加到表情')) return;
      const imgNode = DOMPatcher.findImage(tooltipNode);
      if (!imgNode?.src) return;
      const existing = tc.querySelector('.download-button');
      if (existing) return;
      const btn = document.createElement('div');
      btn.textContent = '下载表情包';
      btn.className = 'LV01TNDE download-button';
      btn.style.cssText = 'cursor: pointer; padding-top: 4px;';
      btn.addEventListener('click', (e3) => {
        e3.stopPropagation();
        this.downloader.download_file(imgNode.src, 'douyin_emoticon');
      });
      tc.appendChild(btn);
    }
    /** 处理播放器控件，注入插件菜单 */
    _handleXgControl(controlNode) {
      // 默认不在播放页显示「插件」按钮与「已推送」徽标（设置里可开启）；
      // 关闭时顺手清掉已注入的节点，保证改设置后立即生效。
      if (((Config.global.features.downloader_config || {}).eagle || {}).show_player_button !== true) {
        try {
          // 1) 优先按注入时记录的引用删（最可靠）
          if (this._injectedPlayerBtn && this._injectedPlayerBtn.isConnected) {
            this._injectedPlayerBtn.remove();
          }
          // 2) 按类名删，并连同 dy-icon / xg-icon 外壳一起移除
          document.querySelectorAll('.dy-dl-video-btn').forEach((el) => {
            const host = el.closest('dy-icon, xg-icon');
            (host || el).remove();
          });
          document.querySelectorAll('.dy-dl-video-pushed').forEach((el) => el.remove());
          // 3) 兜底：自定义图标标签里文字为「插件」的，一律移除
          document.querySelectorAll('dy-icon, xg-icon').forEach((el) => {
            if ((el.textContent || '').trim() === '插件') el.remove();
          });
        } catch (err) {}
        return;
      }
      const rightGrid = controlNode.matches(PLAYER_RIGHT_GRID_SELECTOR)
        ? controlNode
        : controlNode.querySelector(PLAYER_RIGHT_GRID_SELECTOR);
      if (!rightGrid) return;
      const rightGridChildren = Array.from(rightGrid.children);
      if (rightGridChildren.some((child) => child.matches('.dy-dl-video-btn'))) return;
      const isXgPlayer = rightGrid.matches('.xg-right-grid');
      const btn = new TooltipsButton(
        '插件',
        [
          {
            render: () => {
              const item = document.createElement('div');
              item.className = isXgPlayer ? 'xgTips item' : 'item';
              const label = document.createElement('span');
              label.textContent = '快捷键：';
              const shortcut = document.createElement('span');
              shortcut.className = 'shortcutKey';
              shortcut.textContent = this._shortcut_label();
              item.append(label, shortcut);
              return item;
            }
          },
          {
            label: '需求/反馈',
            callback: () =>
              window.open('https://github.com/zhzLuke96/douyin-dl-user-js/issues', '_blank', 'noopener,noreferrer')
          },
          {
            label: '设置',
            callback: () => this.mediaHandler.open_config_modal()
          },
          {
            label: '媒体详情',
            callback: () => this.mediaHandler.show_media_details()
          },
          {
            label: '下载弹幕',
            callback: () => {
              if (!this.mediaHandler.player) {
                alert('当前没有播放器实例');
                return;
              }
              if (!this.mediaHandler.current_media) {
                alert('当前没有媒体实例');
                return;
              }
              const content = this.danmakuHandler.getDanmakuAssFileContent(this.mediaHandler.player);
              if (content) {
                const fn = this.mediaHandler._build_filename(this.mediaHandler.current_media);
                this.downloader.download_blob(
                  new Blob([content], {
                    type: 'text/plain'
                  }),
                  fn + '.ass'
                );
              }
            }
          },
          {
            label: '复制视频帧',
            callback: () => this.videoHandler.copy_current_frame()
          },
          {
            label: '下载视频帧',
            callback: () => this.videoHandler.download_current_frame()
          },
          {
            label: '存到 Eagle',
            callback: () => this.mediaHandler.push_current_to_eagle()
          },
          {
            label: '下载',
            callback: () => this.mediaHandler.download_current_media()
          }
        ],
        () => {},
        isXgPlayer ? 'xgplayer' : 'douyin'
      );
      const db = btn.render();
      this._injectedPlayerBtn = db;
      const findAnchor = (selector) => rightGridChildren.find((child) => child.matches(selector)) || null;
      const qs = findAnchor('.douyin-player-playclarity-setting, .xgplayer-quality-setting');
      const vc = findAnchor('.douyin-player-volume, .xgplayer-volume');
      if (qs && qs.parentNode) qs.parentNode.insertBefore(db, qs);
      else if (vc && vc.parentNode) vc.parentNode.insertBefore(db, vc);
      else rightGrid.appendChild(db);
      // 「已推送」标记（M3）：跟随播放器控件同步，切换作品时会重算
      try {
        const curMedia = this.mediaHandler && this.mediaHandler.current_media;
        const curId = curMedia && curMedia.awemeId ? String(curMedia.awemeId) : '';
        const curRec = curId ? PushHistory.get(curId) : null;
        let hint = rightGrid.querySelector('.dy-dl-video-pushed');
        if (curRec && readPushCfg().badge) {
          if (!hint) {
            hint = document.createElement('div');
            hint.className = 'dy-dl-video-pushed';
            Object.assign(hint.style, {
              display: 'inline-flex',
              alignItems: 'center',
              height: '27px',
              padding: '0 10px',
              boxSizing: 'border-box',
              borderRadius: '999px',
              background: '#1f6f3f',
              border: '1px solid rgba(255,255,255,0.45)',
              color: '#fff',
              fontSize: '12px',
              fontFamily: 'sans-serif',
              whiteSpace: 'nowrap',
              pointerEvents: 'none'
            });
          }
          hint.textContent = '已推送' + (curRec.pushCount > 1 ? ' ×' + curRec.pushCount : '');
          hint.title =
            '已推送到「' +
            (curRec.folderName || '库根目录') +
            '」' +
            (curRec.name ? '：' + curRec.name : '') +
            ' · ' +
            new Date(curRec.pushedAt).toLocaleString();
          rightGrid.appendChild(hint);
        } else if (hint) {
          hint.remove();
        }
      } catch (err) {
        console.warn('[dy-dl] 详情页已推送标记失败', err);
      }
    }
    /** 重算某张卡片的「已推送」标记（虚拟滚动复用、推送成功后都会调它） */
    _refreshPushedBadge(card, maskEl) {
      try {
        const badge = maskEl.querySelector('.dy-dl-feed-pushed');
        if (!badge) return;
        const media = this.profilePageHandler.dataService._extractFeedMedia(card);
        const awemeId = media && media.awemeId ? String(media.awemeId) : '';
        const rec = awemeId ? PushHistory.get(awemeId) : null;
        if (rec && readPushCfg().badge) {
          badge.textContent = '已推送' + (rec.pushCount > 1 ? ' ×' + rec.pushCount : '');
          badge.title =
            '已推送到「' +
            (rec.folderName || '库根目录') +
            '」' +
            (rec.name ? '：' + rec.name : '') +
            ' · ' +
            new Date(rec.pushedAt).toLocaleString();
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      } catch (err) {
        console.warn('[dy-dl] 已推送标记刷新失败', err);
      }
    }
    /** 推送成功后即时刷新页面上该作品的标记（无需刷新页面） */
    refreshPushedBadgeFor(awemeId) {
      try {
        if (!awemeId) return 0;
        const id = String(awemeId);
        let n = 0;
        document.querySelectorAll('.' + this.feed_card_selector_cls).forEach((maskEl) => {
          const card = maskEl.parentElement;
          if (!card) return;
          const media = this.profilePageHandler.dataService._extractFeedMedia(card);
          if (media && String(media.awemeId) === id) {
            this._refreshPushedBadge(card, maskEl);
            n += 1;
          }
        });
        return n;
      } catch (err) {
        console.warn('[dy-dl] 刷新已推送标记失败', err);
        return 0;
      }
    }
    /** 处理个人主页卡片，注入选择器 */
    _handleProfileCard(card) {
      const dom = card.querySelector('.' + this.feed_card_selector_cls);
      if (!Config.global.features.enable_profile_downloader) {
        dom?.remove();
        return;
      } else if (dom) {
        // 卡片被虚拟滚动复用时，awemeId 可能已经变了 —— 必须重算「已推送」标记
        this._refreshPushedBadge(card, dom);
        return;
      }
      const media = this.profilePageHandler.dataService._extractFeedMedia(card);
      const {awemeId} = media || {};
      if (!awemeId) return;
      const pos = window.getComputedStyle(card).position;
      if (!pos || pos === 'static') card.style.position = 'relative';
      const mask = document.createElement('div');
      mask.className = this.feed_card_selector_cls;
      mask.setAttribute('role', 'button');
      mask.setAttribute('aria-label', '切换视频选择');
      Object.assign(mask.style, {
        position: 'absolute',
        inset: '0',
        zIndex: '10',
        cursor: 'pointer',
        background: 'transparent',
        userSelect: 'none',
        touchAction: 'manipulation'
      });
      const badgeGroup = document.createElement('div');
      Object.assign(badgeGroup.style, {
        position: 'absolute',
        top: '10px',
        left: '10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '8px',
        maxWidth: 'calc(100% - 20px)',
        pointerEvents: 'none',
        userSelect: 'none'
      });
      const badge = document.createElement('div');
      Object.assign(badge.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '27px',
        padding: '0 10px',
        boxSizing: 'border-box',
        borderRadius: '999px',
        background: '#2b2b2d',
        border: '1px solid rgba(255,255,255,0.35)',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'sans-serif'
      });
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'dy-dl-feed-checkbox';
      cb.style.cssText = 'margin: 0; pointer-events: none;';
      const label = document.createElement('span');
      label.className = 'dy-dl-feed-select-label';
      label.textContent = '选择';
      badge.append(cb, label);
      const statusRow = document.createElement('div');
      Object.assign(statusRow.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px'
      });
      const makeStatusBadge = (className) => {
        const el = document.createElement('div');
        el.className = className;
        Object.assign(el.style, {
          display: 'inline-flex',
          alignItems: 'center',
          height: '27px',
          padding: '0 10px',
          boxSizing: 'border-box',
          borderRadius: '999px',
          background: '#2b2b2d',
          border: '1px solid rgba(255,255,255,0.35)',
          color: '#fff',
          fontSize: '12px',
          fontFamily: 'sans-serif',
          whiteSpace: 'nowrap'
        });
        return el;
      };
      const contentBadge = makeStatusBadge('dy-dl-feed-content-status');
      const coverBadge = makeStatusBadge('dy-dl-feed-cover-status');
      statusRow.append(contentBadge, coverBadge);
      const pushedBadge = makeStatusBadge('dy-dl-feed-pushed');
      pushedBadge.style.display = 'none';
      pushedBadge.style.background = '#1f6f3f';
      pushedBadge.style.borderColor = 'rgba(255,255,255,0.45)';
      statusRow.append(pushedBadge);
      const metaPanel = document.createElement('div');
      metaPanel.className = 'dy-dl-feed-meta';
      Object.assign(metaPanel.style, {
        display: 'none',
        flexDirection: 'column',
        gap: '2px',
        maxWidth: '100%',
        padding: '6px 10px',
        boxSizing: 'border-box',
        borderRadius: '10px',
        background: '#2b2b2d',
        border: '1px solid rgba(255,255,255,0.35)',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'sans-serif',
        lineHeight: '1.5'
      });
      badgeGroup.append(badge, statusRow, metaPanel);
      mask.append(badgeGroup);
      card.appendChild(mask);
      const renderState = (status) => {
        cb.checked = status.selected;
        mask.setAttribute('aria-pressed', status.selected ? 'true' : 'false');
        mask.style.boxShadow = status.selected ? 'inset 0 0 0 2px rgba(64,150,255,0.75)' : 'none';
        // 「已推送」标记：数据来自 PushHistory 的内存缓存，判断是同步的
        try {
          const pushedRec = PushHistory.get(awemeId);
          if (pushedRec && readPushCfg().badge) {
            pushedBadge.textContent = '已推送' + (pushedRec.pushCount > 1 ? ' ×' + pushedRec.pushCount : '');
            pushedBadge.title =
              '已推送到「' +
              (pushedRec.folderName || '库根目录') +
              '」' +
              (pushedRec.name ? '：' + pushedRec.name : '') +
              ' · ' +
              new Date(pushedRec.pushedAt).toLocaleString();
            pushedBadge.style.display = 'inline-flex';
          } else {
            pushedBadge.style.display = 'none';
          }
        } catch (err) {
          console.warn('[dy-dl] 已推送标记渲染失败', err);
        }
        const contentRunning = status.running && status.runningType === 'content';
        const coverRunning = status.running && status.runningType === 'cover';
        contentBadge.textContent = contentRunning
          ? '内容下载中'
          : status.failed
            ? '内容失败'
            : status.contentDownloaded
              ? '内容已下载'
              : '内容未下载';
        applyFeedStatusStyle(
          contentBadge,
          contentRunning ? 'running' : status.failed ? 'failed' : status.contentDownloaded ? 'downloaded' : 'pending'
        );
        coverBadge.textContent = coverRunning
          ? '封面下载中'
          : status.coverFailed
            ? '封面失败'
            : status.coverDownloaded
              ? '封面已下载'
              : '封面未下载';
        applyFeedStatusStyle(
          coverBadge,
          coverRunning ? 'running' : status.coverFailed ? 'failed' : status.coverDownloaded ? 'downloaded' : 'pending'
        );
        const media2 = this.profilePageHandler.dataService.feedMediaCache.get(awemeId);
        const lines = media2 ? getFeedMetaLines(media2) : [];
        metaPanel.replaceChildren();
        if (lines.length) {
          metaPanel.style.display = 'flex';
          lines.forEach((line) => {
            const row = document.createElement('span');
            row.style.whiteSpace = 'nowrap';
            row.textContent = line;
            metaPanel.append(row);
          });
        } else {
          metaPanel.style.display = 'none';
        }
      };
      const toggle = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const selected = !this.profilePageHandler.downloadManager._isFeedSelected(awemeId);
        this.profilePageHandler.downloadManager.markSelect(awemeId, selected);
      };
      mask.addEventListener('click', toggle);
      mask.addEventListener('mousedown', (ev) => ev.stopPropagation());
      const render = () => {
        if (!mask.parentElement) return;
        renderState(this.profilePageHandler.downloadManager.getFeedCardStatus(awemeId));
      };
      render();
      this.profilePageHandler.downloadManager.on('countsUpdated', render);
      this.profilePageHandler.downloadManager.on('stateChanged', render);
    }
    /** 启动 DOM 观察 */
    startObserving() {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      this._sync_player_controls();
    }
  }
  // ─── src/core/HotkeyManager.ts · 快捷键 ────────────────────────────
  function parseShortcut(shortcut) {
    const parts = shortcut
      .split('+')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return null;
    const result = {
      key: '',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false
    };
    for (const part of parts) {
      if (part === 'ctrl' || part === 'control') result.ctrl = true;
      else if (part === 'alt' || part === 'option') result.alt = true;
      else if (part === 'shift') result.shift = true;
      else if (part === 'meta' || part === 'command' || part === 'cmd' || part === 'win' || part === 'windows')
        result.meta = true;
      else if (result.key) return null;
      else result.key = part;
    }
    return result.key ? result : null;
  }
  function matchesShortcut(ev, shortcut) {
    return (
      ev.key.toLowerCase() === shortcut.key &&
      ev.ctrlKey === shortcut.ctrl &&
      ev.altKey === shortcut.alt &&
      ev.shiftKey === shortcut.shift &&
      ev.metaKey === shortcut.meta
    );
  }
  class HotkeyManager {
    /**
     * 注册快捷键，支持 M、Ctrl+M、Alt+Shift+M 等写法
     */
    addHotkey(shortcut, fn) {
      const parsed = parseShortcut(shortcut);
      if (!parsed)
        return {
          dispose: () => {}
        };
      const callback = (ev) => {
        if (!matchesShortcut(ev, parsed)) return;
        const activeElement = document.activeElement;
        if (activeElement) {
          const tagName = activeElement.tagName;
          const isInputElement = tagName === 'INPUT' || tagName === 'TEXTAREA' || activeElement.isContentEditable;
          if (isInputElement) return;
        }
        ev.preventDefault();
        fn();
      };
      document.addEventListener('keydown', callback);
      const dispose = () => document.removeEventListener('keydown', callback);
      return {
        dispose
      };
    }
  }
  // ─── src/ui/Modal.ts · 模态框 / Toast ──────────────────────────────
  class Modal {
    constructor(callback, onBeforeClose) {
      this.onBeforeClose = onBeforeClose;
      this.overlay = document.createElement('div');
      Object.assign(this.overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '1000'
      });
      this.root = document.createElement('div');
      Object.assign(this.root.style, {
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '8px',
        minWidth: '300px',
        minHeight: '150px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
      });
      this.root.addEventListener('click', (e3) => e3.stopPropagation());
      this.overlay.addEventListener('click', () => {
        if (this.onBeforeClose && !this.onBeforeClose()) return;
        this.close();
      });
      this.overlay.appendChild(this.root);
      document.body.appendChild(this.overlay);
      if (typeof callback === 'function') {
        callback(this.root, this.overlay);
      }
    }
    close() {
      if (this.onBeforeClose && !this.onBeforeClose()) return;
      this.overlay.remove();
    }
  }
  function createToast(target, defaultDuration = 2e3) {
    let toastEl = null;
    let timeoutId = null;
    const getTargetElement = () => {
      if (!target) return null;
      if (typeof target === 'string') return document.querySelector(target);
      return target.nodeType === Node.ELEMENT_NODE ? target : null;
    };
    const updatePosition = () => {
      if (!toastEl) return;
      const targetEl = getTargetElement();
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const top = rect.top - toastEl.offsetHeight - 5;
        const left = rect.left + (rect.width - toastEl.offsetWidth) / 2;
        toastEl.style.top = `${top}px`;
        toastEl.style.left = `${left}px`;
        toastEl.style.right = 'auto';
        toastEl.style.bottom = 'auto';
      } else {
        toastEl.style.bottom = '20px';
        toastEl.style.right = '20px';
        toastEl.style.top = 'auto';
        toastEl.style.left = 'auto';
      }
    };
    const close = () => {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    const update = (message, duration = defaultDuration) => {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'dy-dl-toast';
        Object.assign(toastEl.style, {
          position: 'fixed',
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          padding: '6px 12px',
          borderRadius: '20px',
          fontSize: '12px',
          zIndex: '999999',
          pointerEvents: 'none',
          transition: 'opacity 0.3s',
          fontFamily: 'sans-serif',
          // 推送结果汇总（成功 / 跳过 / 失败 + 原因）可能较长：允许换行并限制最大宽度，避免溢出屏幕
          whiteSpace: 'pre-wrap',
          textAlign: 'center',
          maxWidth: '80vw',
          lineHeight: 1.4
        });
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = message;
      updatePosition();
      if (timeoutId) clearTimeout(timeoutId);
      if (duration > 0) {
        timeoutId = setTimeout(close, duration);
      }
    };
    return {
      update,
      close
    };
  }
  var EAGLE_PUSH_TOAST_MS = 3e3;
  /**
   * 推送结果专用提示：固定在视口底部居中、字号比普通 toast 大，
   * 并挂到全屏元素下，这样作品详情页（含全屏播放器）里点「存到 Eagle」也一定看得见。
   */
  function createEaglePushToast(defaultDuration = EAGLE_PUSH_TOAST_MS) {
    let toastEl = null;
    let timeoutId = null;
    const close = () => {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    const update = (message, duration = defaultDuration) => {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'dy-dl-eagle-toast';
        Object.assign(toastEl.style, {
          position: 'fixed',
          left: '50%',
          bottom: '10vh',
          transform: 'translateX(-50%)',
          zIndex: '2147483600',
          boxSizing: 'border-box',
          maxWidth: 'min(620px, 88vw)',
          padding: '13px 22px',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(18,18,20,0.93)',
          color: '#fff',
          fontSize: '15px',
          lineHeight: 1.55,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          transition: 'opacity 0.2s ease'
        });
        (document.fullscreenElement || document.body).appendChild(toastEl);
      }
      toastEl.textContent = message;
      if (timeoutId) clearTimeout(timeoutId);
      if (duration > 0) timeoutId = setTimeout(close, duration);
    };
    return {
      update,
      close
    };
  }
  // ─── src/handlers/douyin/PlayerAdapter.ts · 播放器适配 ─────────────
  var NEW_PLAYER_MEDIA_PLUGINS = ['WatchLaterPlugin', 'DanmakuPlugin', 'PlayClaritySettingPlugin', 'Pip'];
  var ACTIVE_VIDEO_SELECTORS = [
    '#sliderVideo video',
    '[data-e2e="feed-active-video"] video',
    '.slider-video video',
    '.douyin-player-video-container video',
    '.xg-video-container video'
  ];
  function hasMediaShape(media) {
    if (!media || typeof media !== 'object') return false;
    const hasAwemeId = typeof media.awemeId === 'string' || typeof media.awemeId === 'number';
    return hasAwemeId && (!!media.video || Array.isArray(media.images));
  }
  function isVideoElement(value) {
    try {
      return Boolean(value && (value.tagName === 'VIDEO' || value.localName === 'video'));
    } catch {
      return false;
    }
  }
  function getDouyinPlayer() {
    try {
      const isolated = window.player;
      if (isolated) return isolated;
      return typeof unsafeWindow !== 'undefined' ? unsafeWindow.player : null;
    } catch {
      return null;
    }
  }
  function isNewPlayer(player) {
    return Boolean(player?._config?._config?.pluginsConfig);
  }
  function readPlayerMedia(player) {
    if (!player) return null;
    try {
      const pluginsConfig = player?._config?._config?.pluginsConfig;
      if (pluginsConfig && typeof pluginsConfig === 'object') {
        for (const key of NEW_PLAYER_MEDIA_PLUGINS) {
          const awemeInfo = pluginsConfig[key]?.awemeInfo;
          if (hasMediaShape(awemeInfo)) return awemeInfo;
        }
      }
      if (hasMediaShape(player?.config?.awemeInfo)) return player.config.awemeInfo;
      if (hasMediaShape(player?.controls?.playerConfig?.awemeInfo)) return player.controls.playerConfig.awemeInfo;
    } catch {
      return null;
    }
    return null;
  }
  function readPlayerVideoElement(player) {
    try {
      const directCandidates = [player?.video, player?.controls?.video, player?._video, player?._core?._media];
      for (const candidate of directCandidates) {
        if (isVideoElement(candidate)) return candidate;
      }
    } catch {}
    for (const selector of ACTIVE_VIDEO_SELECTORS) {
      const video = document.querySelector(selector);
      if (video) return video;
    }
    return document.querySelector('video');
  }
  function readPlayerVideoSize(player) {
    const media = readPlayerMedia(player);
    const video = media?.video;
    if (video?.width && video?.height)
      return {
        width: video.width,
        height: video.height
      };
    const videoEl = readPlayerVideoElement(player);
    if (videoEl?.videoWidth && videoEl?.videoHeight)
      return {
        width: videoEl.videoWidth,
        height: videoEl.videoHeight
      };
    return null;
  }
  function subscribePlayer(player, handler) {
    try {
      if (!player || typeof player.on !== 'function') return () => {};
      const on = player.on.bind(player);
      const off =
        typeof player.off === 'function'
          ? player.off.bind(player)
          : typeof player.removeListener === 'function'
            ? player.removeListener.bind(player)
            : null;
      const events = ['play', 'seeked'];
      for (const event of events) {
        try {
          on(event, handler);
        } catch {}
      }
      return () => {
        if (!off) return;
        for (const event of events) off(event, handler);
      };
    } catch {
      return () => {};
    }
  }
  var escapeRegExp2 = (value) => {
    let result = '';
    for (const char of value) {
      if ('\\^$.*+?()[]{}|'.includes(char)) result += '\\';
      result += char;
    }
    return result;
  };
  // ─── src/handlers/douyin/MediaHandler.ts · 作品操作（推送 / 下载） ──
  class MediaHandler {
    constructor(downloader2) {
      this.player = null;
      this.current_media = null;
      this.dispose_player_events = null;
      this.downloading = false;
      this.downloader = downloader2;
      this.download_current_media = this._lock_download(this._download_current_media_logic.bind(this));
    }
    static toShortId(bigintStr) {
      try {
        return BigInt(bigintStr).toString(36);
      } catch {
        return bigintStr;
      }
    }
    /** 文件名
     *
     * [nickname] + [short_id] + [tags] + [desc]
     * max length: 64
     */
    _build_filename(
      media = this.current_media,
      filename_template = Config.global.features.filename_template || Config.defaults.filename_template,
      filename_max_length = Config.global.features.filename_max_length || 64,
      throw_err = false
    ) {
      if (!media) {
        throw new Error('缺少 media');
      }
      const {
        authorInfo: {nickname},
        awemeId,
        desc,
        textExtra
      } = media;
      const short_id = MediaHandler.toShortId(awemeId);
      const tag_list = textExtra?.map((x2) => x2.hashtagName).filter(Boolean) || [];
      const tags = tag_list.map((x2) => '#' + x2).join('_');
      let rawDesc = desc || '';
      tag_list.forEach((t3) => {
        rawDesc = rawDesc.replace(new RegExp('#' + escapeRegExp2(t3) + '\\s*', 'g'), '');
      });
      rawDesc = rawDesc.trim().replace(/[#/?<>\\:*|":]/g, '_');
      const context = {
        nickname,
        short_id,
        tags,
        desc: rawDesc,
        aweme_id: awemeId,
        media,
        author_info: media.authorInfo,
        uid: media.authorUserId,
        music_name: media.music?.musicName || '',
        now_date: new Date(),
        create_date: new Date(media.createTime * 1e3)
      };
      context.now_YYYYMMDD = formatDate(context.now_date, 'YYYYMMDD');
      context.now_YYYYMMDD_HHmmss = formatDate(context.now_date, 'YYYYMMDD_HHmmss');
      context.create_date_YYYYMMDD = formatDate(context.create_date, 'YYYYMMDD');
      context.create_date_YYYYMMDD_HHmmss = formatDate(context.create_date, 'YYYYMMDD_HHmmss');
      let baseName;
      try {
        baseName = runInContext(context, filename_template);
      } catch (error) {
        if (throw_err) throw error;
        console.error('[dy-dl] Error rendering filename template:', error);
        baseName = runInContext(context, Config.defaults.filename_template);
      }
      return normalizeBasename(baseName, {
        maxLength: filename_max_length
      });
    }
    _bind_player_events() {
      if (!this.player) return;
      this.dispose_player_events?.();
      const update = () => {
        const media = readPlayerMedia(this.player);
        if (media) this.current_media = media;
      };
      update();
      this.dispose_player_events = subscribePlayer(this.player, update);
    }
    /**
     * !!!
     * 此为核心逻辑
     * !!!
     *
     * NOTE: 有可能在某次抖音更新之后就不可用，依赖于 xg-video 对全局状态注入
     */
    async _start_detect_player_change() {
      while (true) {
        const cp = getDouyinPlayer();
        if (this.player !== cp) {
          this.player = cp;
          if (this.player) this._bind_player_events();
        }
        const media = readPlayerMedia(cp);
        if (media) this.current_media = media;
        await new Promise((r3) => setTimeout(r3, 1e3));
      }
    }
    _flag_start_download() {
      this.downloading = true;
      return () => {
        this.downloading = false;
      };
    }
    _lock_download(fn) {
      return async (...args) => {
        if (this.downloading) {
          alert('[dy-dl]正在下载中...请稍等或刷新页面');
          return;
        }
        const release = this._flag_start_download();
        try {
          await fn(...args);
        } finally {
          await new Promise((r3) => setTimeout(r3, 300));
          release();
        }
      };
    }
    /**
     * 从 video 对象上取得所有 url，支持分辨率策略 + 编码偏好
     * 先按 codec 筛选，再按分辨率模式筛选
     */
    _get_video_urls(video_obj) {
      if (!video_obj) return [];
      const mode = Config.global.features.download_video_mode || 'default';
      const codecPref = Config.global.features.video_download_codecs || 'default';
      const isH265 = (br) =>
        br.isH265 === 1 ||
        (br.gearName || '').toLowerCase().includes('h265') ||
        (br.format || '').toLowerCase().includes('h265');
      const extractUrls = (br) => {
        const urls = [];
        if (br.playApi) urls.push(br.playApi);
        if (Array.isArray(br.playAddr)) urls.push(...br.playAddr.map((a3) => a3.src));
        return urls.filter(Boolean);
      };
      if (!video_obj.bitRateList || video_obj.bitRateList.length === 0) return this._get_video_urls_default(video_obj);
      const bitRateList = video_obj.bitRateList.filter((x2) => x2.format !== 'dash');
      let candidates = [...bitRateList];
      if (codecPref !== 'default') {
        const isPrefer = codecPref.endsWith('_prefer');
        const wantH265 = codecPref.includes('h265');
        const matched = candidates.filter((br) => isH265(br) === wantH265);
        if (matched.length > 0) candidates = matched;
        else if (!isPrefer) return this._get_video_urls_default(video_obj);
      }
      if (mode !== 'default' && candidates.length > 1) {
        const vsizeof = (a3) => (a3?.width || 0) * (a3?.height || 0);
        const fsizeof = (a3) => a3.dataSize || 0;
        if (mode === 'max') candidates.sort((a3, b) => vsizeof(b) - vsizeof(a3));
        else if (mode === 'min') candidates.sort((a3, b) => vsizeof(a3) - vsizeof(b));
        else if (mode === 'max_file') candidates.sort((a3, b) => fsizeof(b) - fsizeof(a3));
        else if (mode === 'min_file') candidates.sort((a3, b) => fsizeof(a3) - fsizeof(b));
        if (['1080P', '720P', '540P', '360P', '2K', '4K'].includes(mode)) {
          const kwMap = {
            '1080P': ['1080'],
            '720P': ['720'],
            '540P': ['540'],
            '360P': ['360'],
            '2K': ['2k', '2048'],
            '4K': ['4K', '4096']
          };
          const kws = kwMap[mode] || [];
          const matched = candidates.filter((br) =>
            kws.some((kw) => (br.gearName || '').toLowerCase().includes(kw.toLowerCase()))
          );
          if (matched.length > 0) candidates = matched;
        }
      }
      const allUrls = [];
      candidates.forEach((br) => allUrls.push(...extractUrls(br)));
      if (codecPref === 'default' || codecPref.includes('h264')) {
        if (video_obj.playApi) allUrls.push(video_obj.playApi);
      }
      if (codecPref === 'default' || codecPref.includes('h265')) {
        if (video_obj.playApiH265) allUrls.push(video_obj.playApiH265);
      }
      const result = Array.from(new Set(allUrls.filter(Boolean)));
      if (result.length === 0) return this._get_video_urls_default(video_obj);
      return result;
    }
    /** 默认的 URL 提取逻辑 */
    _get_video_urls_default(video_obj) {
      const sources = [];
      if (video_obj.playApi) sources.push(video_obj.playApi);
      if (Array.isArray(video_obj.playAddr)) sources.push(...video_obj.playAddr.map((x2) => x2.src));
      if (video_obj.bitRateList)
        video_obj.bitRateList
          .filter((x2) => x2.format !== 'dash')
          .forEach((x2) => {
            if (x2.playApi) sources.push(x2.playApi);
          });
      if (video_obj.playApiH265) sources.push(video_obj.playApiH265);
      return Array.from(new Set(sources.filter(Boolean)));
    }
    /**
     * 抖音作品有两种形式：
     * 1. 单图、单视频
     * 2. 图集
     *
     * 如果是图集形式，必须从 images 这个数组里面取字段，其他字段都有可能是 fallback 值
     */
    async _download_media_logic(media, options = {}) {
      const {
        toastTarget = null,
        toast = null,
        toastPrefix = '',
        alertOnFail = true,
        addHistory = true,
        downloaderOverride = ''
      } = options;
      const isEaglePush = downloaderOverride === 'eagle';
      // 一次 _download_media_logic 调用 = 一次推送动作（图集有 N 个媒体也只算一次）
      if (!options._dyBatchId)
        options._dyBatchId = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const actionWord = isEaglePush ? '推送' : '下载';
      if (!media) {
        if (alertOnFail) alert('[dy-dl]无当前媒体信息');
        return {
          ok: false,
          reason: 'missing_media'
        };
      }
      const {video, images} = media;
      const filename_base = this._build_filename(media);
      const isAlbum = Array.isArray(images) && images.length > 0;
      const total = isAlbum ? images.length : 1;
      const scopedToast = toast || createToast(toastTarget, 5e3);
      // 推送结果用专用提示（底部居中、字号更大）：详情页的 .dy-dl-video-btn 可能不在视口内，
      // 普通 toast 会跟着按钮跑出屏幕；批量任务里 toast 由调用方接管，这里不重复弹。
      const pushToast = isEaglePush && !toast ? createEaglePushToast() : null;
      const toastUpdate = (msg, dur = 5e3) => {
        const p3 = toastPrefix ? toastPrefix + ' ' + msg : msg;
        (pushToast || scopedToast).update(p3, dur);
      };
      /** 小红书式推送结果提示：成功 / 跳过 / 失败的数量汇总，失败时带上原因（统一停留 3 秒） */
      const toastPushSummary = (stats) => {
        const parts = [];
        if (stats.saved > 0) parts.push(stats.saved + ' 成功');
        if (stats.skipped > 0) parts.push(stats.skipped + ' 跳过');
        if (stats.failed > 0) parts.push(stats.failed + ' 失败');
        if (stats.failed > 0 && stats.saved === 0 && stats.skipped === 0) {
          toastUpdate('❌ 推送失败：' + (stats.error || '未知原因'), EAGLE_PUSH_TOAST_MS);
        } else if (stats.failed > 0) {
          toastUpdate(
            '⚠️ 已推送到 Eagle：' + parts.join('，') + '；失败原因：' + (stats.error || '未知'),
            EAGLE_PUSH_TOAST_MS
          );
        } else if (stats.saved === 0 && stats.skipped > 0) {
          toastUpdate('⏭️ 已在 Eagle 中，跳过 ' + stats.skipped + ' 个', EAGLE_PUSH_TOAST_MS);
        } else if (stats.saved === 0) {
          toastUpdate('没有可推送的素材', EAGLE_PUSH_TOAST_MS);
        } else {
          toastUpdate('✅ 已推送到 Eagle：' + parts.join('，'), EAGLE_PUSH_TOAST_MS);
        }
      };
      if (isAlbum) {
        let downloadedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;
        let lastError2 = '';
        for (let idx = 0; idx < images.length; idx++) {
          toastUpdate(actionWord + '图集 (' + (idx + 1) + '/' + total + ')');
          const item = images[idx];
          const fn = filename_base + '_' + (idx + 1);
          const animMode = Config.global.features.animated_image_mode || 'webp';
          const wantOrigin = Config.global.features.prefer_origin_image !== false;
          const originUrls = wantOrigin ? Downloader.collectOriginUrls(item) : [];
          if (wantOrigin && originUrls.length === 0 && !this._originFieldProbed) {
            this._originFieldProbed = true;
            console.info('[dy-dl] 未找到原图字段，当前图片可用字段：', Object.keys(item));
          }
          const imgUrls = [...originUrls, ...(item.urlList || []), ...(item.downloadUrlList || [])].filter(Boolean);
          const vidUrls = item.video ? this._get_video_urls(item.video) : [];
          const jobs = [];
          if (item.video) {
            const wantImg = animMode !== 'video' && imgUrls.length > 0;
            const wantVid = animMode !== 'webp' && vidUrls.length > 0;
            if (wantImg)
              jobs.push({
                urls: imgUrls,
                type: 'image',
                name: fn
              });
            if (wantVid)
              jobs.push({
                urls: vidUrls,
                type: 'video',
                name: wantImg ? fn + '_anim' : fn
              });
            if (jobs.length === 0 && imgUrls.length > 0)
              jobs.push({
                urls: imgUrls,
                type: 'image',
                name: fn
              });
            if (jobs.length === 0 && vidUrls.length > 0)
              jobs.push({
                urls: vidUrls,
                type: 'video',
                name: fn
              });
          } else if (imgUrls.length > 0) {
            jobs.push({
              urls: imgUrls,
              type: 'image',
              name: fn
            });
          }
          if (jobs.length === 0) {
            failedCount++;
            lastError2 = lastError2 || (item.video ? '未找到图片/视频地址' : '未找到图片地址');
            continue;
          }
          for (const job of jobs) {
            const dl = await this.downloader.download_file_with_error(job.urls[0], job.name, job.urls, {
              silent: !alertOnFail || isEaglePush,
              media,
              mediaType: job.type,
              downloaderOverride
            });
            if (dl.ok) {
              if (dl.skipped) skippedCount++;
              else downloadedCount++;
            } else {
              failedCount++;
              lastError2 = lastError2 || dl.error_msg;
            }
          }
        }
        if (isEaglePush) {
          toastPushSummary({
            saved: downloadedCount,
            skipped: skippedCount,
            failed: failedCount,
            error: lastError2
          });
        } else {
          toastUpdate('图集' + actionWord + '完成');
        }
        if (downloadedCount === 0 && skippedCount === 0 && images.length > 0) {
          if (alertOnFail && !isEaglePush) alert('[dy-dl]图集下载失败');
          return {
            ok: false,
            reason: 'no_valid_media',
            message: lastError2 || '图集下载失败',
            saved: 0,
            skipped: 0,
            failed: failedCount
          };
        }
        if (downloadedCount && addHistory) DownloadHistory.add(media);
        return {
          ok: downloadedCount > 0 || skippedCount > 0,
          saved: downloadedCount,
          skipped: skippedCount,
          failed: failedCount
        };
      }
      toastUpdate(isEaglePush ? '正在推送到 Eagle...' : '正在下载...');
      const video_urls = this._get_video_urls(video);
      let lastError;
      if (video_urls.length > 0) {
        const dl = await this.downloader.download_file_with_error(video_urls[0], filename_base, video_urls, {
          silent: !alertOnFail || isEaglePush,
          media,
          mediaType: 'video',
          downloaderOverride
        });
        if (dl.ok && addHistory) DownloadHistory.add(media);
        if (dl.ok) {
          if (isEaglePush) {
            toastPushSummary({
              saved: dl.skipped ? 0 : 1,
              skipped: dl.skipped ? 1 : 0,
              failed: 0
            });
          } else {
            toastUpdate(actionWord + '完成');
          }
          return {
            ok: true,
            skipped: dl.skipped ? 1 : 0,
            saved: dl.skipped ? 0 : 1,
            failed: 0
          };
        }
        lastError = dl.error_msg;
      } else {
        lastError = '未找到视频地址';
      }
      if (isEaglePush)
        toastPushSummary({
          saved: 0,
          skipped: 0,
          failed: 1,
          error: lastError
        });
      if (alertOnFail && !isEaglePush) alert('[dy-dl]无法下载当前媒体');
      return {
        ok: false,
        reason: 'no_valid_media',
        message: lastError || '无法下载当前媒体',
        saved: 0,
        skipped: 0,
        failed: 1
      };
    }
    async _download_cover_logic(media, options = {}) {
      const {alertOnFail = true, downloaderOverride = ''} = options;
      if (!media) {
        if (alertOnFail) alert('[dy-dl]无当前媒体信息');
        return {
          ok: false,
          reason: 'missing_media'
        };
      }
      const coverUrl = getBestCoverUrl(media);
      if (!coverUrl)
        return {
          ok: false,
          reason: 'no_cover',
          message: '未找到封面地址'
        };
      const dl = await this.downloader.download_file_with_error(coverUrl, 'thumb_' + this._build_filename(media), [], {
        silent: !alertOnFail,
        media,
        mediaType: 'image',
        downloaderOverride
      });
      if (!dl.ok)
        return {
          ok: false,
          reason: 'cover_download_failed',
          message: dl.error_msg || '封面下载失败'
        };
      return {
        ok: true
      };
    }
    async _download_current_media_logic() {
      return this._download_media_logic(this.current_media, {
        toastTarget: document.querySelector('.dy-dl-video-btn'),
        alertOnFail: true,
        addHistory: true
      });
    }
    /**
     * 把当前作品直接推送到 Eagle（不改变全局下载器设置）
     *
     * 反馈用底部居中的大号提示，作品详情页（含全屏播放器）里也一定看得见；
     * 没有读到作品数据时同样给提示，而不是静默失败。
     */
    async push_current_to_eagle() {
      if (!this.current_media) {
        createEaglePushToast().update('❌ 没读到作品数据：请先播放当前作品，或刷新页面后重试', EAGLE_PUSH_TOAST_MS);
        return {
          ok: false
        };
      }
      return this._download_media_logic(this.current_media, {
        toastTarget: document.querySelector('.dy-dl-video-btn'),
        alertOnFail: true,
        addHistory: false,
        downloaderOverride: 'eagle'
      });
    }
    // 下载封面
    async download_thumb() {
      if (!this.current_media) {
        alert('[dy-dl] 无当前媒体信息');
        return;
      }
      const bestThumb = getBestCoverUrl(this.current_media);
      if (!bestThumb) {
        alert('[dy-dl] 未找到任何可用的封面图');
        return;
      }
      this.downloader.download_file(bestThumb, 'thumb_' + this._build_filename(this.current_media), [], {
        media: this.current_media,
        mediaType: 'image'
      });
    }
    // 显示媒体详情
    async show_media_details() {
      if (!this.current_media) {
        alert('[dy-dl]无当前媒体信息');
        return;
      }
      const modal = new Modal((_root, overlay) => {
        overlay.style.zIndex = '999999';
        if (document.fullscreenElement) document.fullscreenElement.appendChild(overlay);
      });
      modal.root.style.cssText =
        'width:800px;max-width:90vw;background:transparent;box-shadow:none;border-radius:8px;overflow:hidden';
      const filenameBase = this._build_filename(this.current_media);
      try {
        render(
          jsx(MediaDetailModalApp, {
            media: this.current_media,
            filenameBase
          }),
          modal.root
        );
      } catch (err) {
        console.error('[dy-dl] 媒体详情组件加载失败', err);
        modal.root.textContent = '组件加载失败，请刷新重试';
      }
    }
    async open_config_modal() {
      const modal = new Modal((_root, overlay) => {
        overlay.style.zIndex = '999999';
        if (document.fullscreenElement) document.fullscreenElement.appendChild(overlay);
      });
      modal.root.style.cssText =
        'width:650px;max-width:90vw;background:transparent;box-shadow:none;border-radius:8px;overflow:hidden';
      try {
        render(
          jsx(ConfigModalApp, {
            config: Config.global,
            modal
          }),
          modal.root
        );
      } catch (err) {
        console.error('[dy-dl] 配置组件加载失败', err);
        modal.root.textContent = '组件加载失败';
      }
    }
    init() {
      this._start_detect_player_change();
    }
  }
  // ─── src/handlers/douyin/VideoHandler.ts · 视频页 ──────────────────
  class VideoHandler {
    constructor() {
      this._frameBlob = null;
    }
    /** 获取当前可见的视频元素 */
    getVideoElement() {
      return readPlayerVideoElement(getDouyinPlayer());
    }
    /** 截取当前视频帧，返回 Blob 和 DataURL */
    getCurrentFrame() {
      const video = this.getVideoElement();
      if (!video) return null;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const url = canvas.toDataURL('image/png');
      canvas.toBlob((blob) => {
        if (blob) this._frameBlob = blob;
      });
      return {
        blob: this._frameBlob,
        url
      };
    }
    /** 复制当前视频帧到剪贴板 */
    async copy_current_frame() {
      const video = this.getVideoElement();
      if (!video) {
        alert('未找到视频元素');
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const blob = await new Promise((r3) => canvas.toBlob((b) => r3(b), 'image/png'));
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': blob
          })
        ]);
      } catch (err) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const url = canvas.toDataURL('image/png');
        const img = new Image();
        img.src = url;
        document.body.appendChild(img);
        Object.assign(img.style, {
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          zIndex: 999999,
          maxWidth: '90vw',
          maxHeight: '90vh'
        });
        img.onclick = () => img.remove();
        console.error('复制帧失败(已显示图像):', err);
      }
    }
    /** 下载当前视频帧 */
    async download_current_frame() {
      const video = this.getVideoElement();
      if (!video) {
        alert('未找到视频元素');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise((r3) => canvas.toBlob((b) => r3(b), 'image/png'));
      const link = document.createElement('a');
      link.download = normalizeFilename('frame_' + Date.now() + '.png');
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    }
  }
  // ─── src/handlers/douyin/DanmakuHandler.ts · 弹幕转 ASS ───────────
  class DanmakuHandler {
    /** 获取弹幕列表 */
    getDanmakuList(player) {
      return player?.danmaku?.main?.data || [];
    }
    /** 获取视频宽高 */
    getMediaSize(player) {
      const legacy = {
        width: player?.sizeInfo?.width,
        height: player?.sizeInfo?.height
      };
      if (legacy.width && legacy.height)
        return {
          width: legacy.width,
          height: legacy.height
        };
      const size = readPlayerVideoSize(player);
      if (size) return size;
      return {
        width: 1920,
        height: 1080
      };
    }
    /** 毫秒转 ASS 时间格式 */
    msToAssTime(ms) {
      const totalSec = ms / 1e3;
      const h3 = Math.floor(totalSec / 3600);
      const m3 = Math.floor((totalSec % 3600) / 60);
      const s5 = totalSec % 60;
      return `${h3}:${String(m3).padStart(2, '0')}:${s5.toFixed(2).padStart(5, '0')}`.replace(/^0:/, '');
    }
    /** 十六进制颜色转 ASS 颜色格式 */
    hexToAssColor(hex) {
      if (!hex || hex === 'transparent') return '&H00FFFFFF';
      const c4 = hex.replace('#', '');
      if (c4.length === 6) return '&H00' + c4.slice(4, 6) + c4.slice(2, 4) + c4.slice(0, 2);
      return '&H00FFFFFF';
    }
    /**
     * 将弹幕数据转换为 ASS 文件内容
     */
    convertDanmakuToAss(list, options = {}) {
      const {title = '', playResX = 1920, playResY = 1080} = options;
      const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
Title: ${title}
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
      const events = list
        .map((d3) => {
          const time = d3.time ?? 0;
          const content = d3.content ?? '';
          const start = this.msToAssTime(time);
          const end = this.msToAssTime(time + 3e3);
          return `Dialogue: 0,${start},${end},Default,,0,0,0,,${content}`;
        })
        .join('\n');
      return header + '\n' + events;
    }
    /**
     * 获取弹幕 ASS 文件内容
     */
    getDanmakuAssFileContent(player) {
      const list = this.getDanmakuList(player);
      if (!list || list.length === 0) {
        alert(isNewPlayer(player) ? '[dy-dl]新版播放器弹幕功能正在适配中' : '当前视频弹幕为空，或者未加载完成');
        return;
      }
      const size = this.getMediaSize(player);
      return this.convertDanmakuToAss(list, {
        title: 'download from https://github.com/zhzLuke96/douyin-dl-user-js',
        playResX: size.width,
        playResY: size.height
      });
    }
  }
  // ─── src/ui/modals/ProfileJobModal.tsx · 批量任务弹窗 ──────────────
  var profileJobCss = createCSS();
  var profileJobStyles = {
    overlay: profileJobCss({
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999999
    }),
    modal: profileJobCss({
      display: 'flex',
      flexDirection: 'column',
      height: '75vh',
      width: '960px',
      maxWidth: '95vw',
      overflow: 'hidden',
      fontFamily: 'sans-serif',
      background: theme.colors.bgOverlay,
      backdropFilter: theme.backdropBlur,
      borderRadius: theme.borderRadius.lg,
      color: theme.colors.textPrimary,
      boxShadow: '0 10px 30px rgba(0,0,0,0.22)'
    }),
    header: profileJobCss({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: theme.spacing.lg,
      borderBottom: '1px solid ' + theme.colors.borderLight
    }),
    title: profileJobCss({
      margin: 0,
      fontSize: '16px',
      fontWeight: 600
    }),
    closeBtn: profileJobCss({
      background: 'none',
      border: 'none',
      color: theme.colors.textSecondary,
      fontSize: '20px',
      cursor: 'pointer'
    }),
    statsBar: profileJobCss({
      display: 'flex',
      gap: '24px',
      padding: '0 ' + theme.spacing.xl + ' ' + theme.spacing.md,
      fontSize: '13px',
      color: theme.colors.textMuted,
      borderBottom: '1px solid ' + theme.colors.borderLight
    }),
    filterBar: profileJobCss({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.md + ' ' + theme.spacing.xl,
      borderBottom: '1px solid ' + theme.colors.borderLight,
      background: theme.colors.bgNav
    }),
    searchInput: profileJobCss({
      flex: 1,
      padding: '6px 14px',
      borderRadius: theme.borderRadius.full,
      border: '1px solid ' + theme.colors.borderInput,
      background: 'rgba(255,255,255,0.08)',
      color: theme.colors.textPrimary,
      fontSize: theme.fontSize.sm,
      outline: 'none',
      '&:focus': {
        borderColor: theme.colors.primary
      }
    }),
    typeFilterSelect: profileJobCss({
      padding: '4px 10px',
      borderRadius: theme.borderRadius.full,
      border: '1px solid ' + theme.colors.borderInput,
      background: 'rgba(255,255,255,0.08)',
      color: theme.colors.textPrimary,
      fontSize: theme.fontSize.sm,
      outline: 'none',
      cursor: 'pointer',
      '& option': {
        background: '#2c2c2e',
        color: theme.colors.textPrimary
      }
    }),
    tableContainer: profileJobCss({
      flexGrow: 1,
      overflowY: 'auto',
      padding: '0 ' + theme.spacing.xl + ' 20px',
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(255,255,255,0.3) rgba(0,0,0,0.2)'
    }),
    table: profileJobCss({
      width: '100%',
      fontSize: '12px',
      borderCollapse: 'collapse',
      color: theme.colors.textPrimary
    }),
    th: profileJobCss({
      position: 'sticky',
      top: 0,
      background: 'rgba(18,18,20,0.98)',
      backdropFilter: 'blur(5px)',
      padding: '10px 8px',
      textAlign: 'left',
      borderBottom: '1px solid ' + theme.colors.borderMedium,
      fontWeight: 600,
      color: theme.colors.textSecondary,
      whiteSpace: 'nowrap'
    }),
    thBtn: profileJobCss({
      background: 'none',
      border: 'none',
      padding: '0',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      whiteSpace: 'nowrap'
    }),
    thArrow: profileJobCss({
      fontSize: '10px',
      opacity: 0.55
    }),
    thArrowActive: profileJobCss({
      color: theme.colors.primary,
      opacity: 1
    }),
    td: profileJobCss({
      padding: '10px 8px',
      borderBottom: '1px solid ' + theme.colors.borderLight,
      verticalAlign: 'middle'
    }),
    checkbox: profileJobCss({
      width: '18px',
      height: '18px',
      cursor: 'pointer',
      accentColor: theme.colors.primary
    }),
    cover: profileJobCss({
      width: '48px',
      height: '64px',
      objectFit: 'cover',
      borderRadius: theme.borderRadius.sm,
      background: 'rgba(255,255,255,0.05)',
      display: 'block'
    }),
    coverHidden: profileJobCss({
      opacity: 0,
      visibility: 'hidden'
    }),
    desc: profileJobCss({
      maxWidth: '180px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }),
    idText: profileJobCss({
      fontSize: '11px',
      color: 'rgba(255,255,255,0.5)',
      wordBreak: 'break-all',
      lineHeight: 1.4
    }),
    typeBadge: profileJobCss({
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: theme.borderRadius.full,
      fontSize: '11px',
      background: 'rgba(255,255,255,0.1)',
      color: theme.colors.textPrimary
    }),
    statusBadge: profileJobCss({
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: theme.borderRadius.full,
      fontSize: '11px'
    }),
    statusGroup: profileJobCss({
      display: 'flex',
      gap: '4px',
      flexWrap: 'wrap'
    }),
    statusDownloaded: profileJobCss({
      background: 'rgba(46,125,50,0.25)',
      color: '#81c784',
      border: '1px solid rgba(46,125,50,0.5)'
    }),
    statusFailed: profileJobCss({
      background: 'rgba(198,40,40,0.25)',
      color: '#ef9a9a',
      border: '1px solid rgba(198,40,40,0.5)'
    }),
    statusPending: profileJobCss({
      background: 'rgba(254,44,85,0.15)',
      color: '#ff8a80',
      border: '1px solid rgba(254,44,85,0.4)'
    }),
    actionBar: profileJobCss({
      display: 'flex',
      gap: '10px',
      padding: theme.spacing.md + ' ' + theme.spacing.xl,
      borderTop: '1px solid ' + theme.colors.borderLight,
      flexWrap: 'wrap'
    }),
    btn: profileJobCss({
      padding: '7px 18px',
      borderRadius: theme.borderRadius.full,
      border: '1px solid ' + theme.colors.borderInput,
      background: 'transparent',
      color: 'rgba(255,255,255,0.9)',
      fontSize: '12px',
      cursor: 'pointer',
      transition: '0.2s',
      '&:disabled': {
        opacity: 0.5,
        cursor: 'not-allowed'
      }
    }),
    btnPrimary: profileJobCss({
      padding: '7px 18px',
      borderRadius: theme.borderRadius.full,
      border: 'none',
      background: theme.colors.primary,
      color: '#fff',
      fontSize: '12px',
      cursor: 'pointer',
      transition: '0.2s',
      fontWeight: 500,
      '&:disabled': {
        opacity: 0.5,
        cursor: 'not-allowed'
      }
    }),
    failSection: profileJobCss({
      marginTop: theme.spacing.lg
    }),
    failTitle: profileJobCss({
      margin: '0 0 8px',
      fontSize: '14px',
      color: '#ff6b6b'
    }),
    statRow: profileJobCss({
      display: 'flex',
      justifyContent: 'space-between',
      padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontSize: '13px'
    }),
    statLabel: profileJobCss({
      color: theme.colors.textMuted
    }),
    statValue: profileJobCss({
      color: theme.colors.textPrimary,
      fontWeight: 500
    }),
    failTable: profileJobCss({
      width: '100%',
      fontSize: '12px',
      borderCollapse: 'collapse',
      borderRadius: theme.borderRadius.sm,
      overflow: 'hidden'
    }),
    failTh: profileJobCss({
      padding: theme.spacing.sm,
      background: 'rgba(255,255,255,0.06)',
      textAlign: 'left',
      color: theme.colors.textMuted,
      fontWeight: 600,
      whiteSpace: 'nowrap'
    }),
    failTd: profileJobCss({
      padding: theme.spacing.sm,
      borderBottom: '1px solid ' + theme.colors.borderLight,
      color: theme.colors.textSecondary,
      verticalAlign: 'top'
    }),
    failId: profileJobCss({
      wordBreak: 'break-all',
      fontSize: '11px',
      color: theme.colors.textSecondary
    }),
    failDesc: profileJobCss({
      maxWidth: '220px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }),
    failMessage: profileJobCss({
      wordBreak: 'break-all',
      color: '#ff9c9c'
    }),
    failEmpty: profileJobCss({
      padding: '24px',
      textAlign: 'center',
      color: theme.colors.textDim,
      fontSize: '12px'
    }),
    progressBarContainer: profileJobCss({
      height: '6px',
      background: 'rgba(255,255,255,0.1)',
      borderRadius: '3px',
      overflow: 'hidden'
    }),
    progressBarFill: profileJobCss({
      height: '100%',
      background: theme.colors.primary,
      borderRadius: '3px',
      transition: 'width 0.3s'
    }),
    squareContainer: profileJobCss({
      display: 'flex',
      flexWrap: 'wrap',
      gap: '3px',
      maxHeight: '84px',
      overflowY: 'auto',
      padding: '8px',
      marginTop: theme.spacing.sm,
      background: 'rgba(0,0,0,0.28)',
      borderRadius: theme.borderRadius.sm
    }),
    square: profileJobCss({
      width: '12px',
      height: '12px',
      borderRadius: '2px',
      flex: '0 0 12px'
    }),
    squarePending: profileJobCss({
      background: '#2a2a2a'
    }),
    squareRunning: profileJobCss({
      background: '#ffb74d'
    }),
    squareSuccess: profileJobCss({
      background: '#66bb6a'
    }),
    squareFailed: profileJobCss({
      background: '#ef5350'
    }),
    footer: profileJobCss({
      padding: '8px 32px',
      fontSize: '11px',
      color: theme.colors.textDim,
      borderTop: '1px solid ' + theme.colors.borderLight
    }),
    statusText: profileJobCss({
      fontSize: '12px',
      color: theme.colors.textMuted,
      margin: '0 32px 6px'
    }),
    tabs: profileJobCss({
      display: 'flex',
      gap: '6px',
      padding: '0 ' + theme.spacing.xl,
      borderBottom: '1px solid ' + theme.colors.borderLight
    }),
    tab: profileJobCss({
      padding: '10px 14px',
      background: 'none',
      border: 'none',
      borderBottom: '2px solid transparent',
      color: theme.colors.textMuted,
      fontSize: '13px',
      cursor: 'pointer',
      '&:hover': {
        color: theme.colors.textPrimary
      }
    }),
    tabActive: profileJobCss({
      color: theme.colors.textPrimary,
      fontWeight: 600,
      borderBottomColor: theme.colors.primary
    }),
    jobContent: profileJobCss({
      flexGrow: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden'
    }),
    jobSummary: profileJobCss({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.md + ' ' + theme.spacing.xl,
      borderBottom: '1px solid ' + theme.colors.borderLight,
      fontSize: '13px',
      color: theme.colors.textMuted,
      flexWrap: 'wrap'
    }),
    progressSection: profileJobCss({
      padding: theme.spacing.md + ' ' + theme.spacing.xl + ' 0'
    }),
    progressLabel: profileJobCss({
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '6px',
      fontSize: '12px',
      color: theme.colors.textMuted
    }),
    logContainer: profileJobCss({
      flexGrow: 1,
      minHeight: 0,
      overflowY: 'auto',
      margin: theme.spacing.md + ' ' + theme.spacing.xl,
      padding: theme.spacing.sm,
      background: 'rgba(0,0,0,0.28)',
      border: '1px solid ' + theme.colors.borderLight,
      borderRadius: theme.borderRadius.sm,
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(255,255,255,0.3) rgba(0,0,0,0.2)'
    }),
    logList: profileJobCss({
      margin: 0,
      padding: 0,
      listStyle: 'none'
    }),
    logItem: profileJobCss({
      display: 'flex',
      gap: '8px',
      padding: '4px 8px',
      fontSize: '12px',
      lineHeight: 1.5,
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      alignItems: 'baseline'
    }),
    logTime: profileJobCss({
      color: theme.colors.textDim,
      whiteSpace: 'nowrap',
      fontFamily: 'monospace'
    }),
    logType: profileJobCss({
      color: theme.colors.textSecondary,
      whiteSpace: 'nowrap'
    }),
    logDesc: profileJobCss({
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }),
    logStatusInfo: profileJobCss({
      color: theme.colors.textMuted,
      whiteSpace: 'nowrap'
    }),
    logStatusRunning: profileJobCss({
      color: '#ffb74d',
      whiteSpace: 'nowrap'
    }),
    logStatusSuccess: profileJobCss({
      color: '#81c784',
      whiteSpace: 'nowrap'
    }),
    logStatusFailed: profileJobCss({
      color: '#ef9a9a',
      whiteSpace: 'nowrap'
    }),
    emptyLog: profileJobCss({
      padding: '24px',
      textAlign: 'center',
      color: theme.colors.textDim,
      fontSize: '12px'
    })
  };
  var clampConcurrency = (value) => {
    const next = Number.isFinite(value) ? Math.floor(value) : 1;
    return Math.min(Math.max(next, 1), 5);
  };
  var formatModalFileSize = (bytes) => {
    if (!bytes || bytes <= 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return value.toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
  };
  var formatModalDuration = (duration) => {
    if (!duration || duration <= 0) return '-';
    const totalSeconds = Math.max(1, Math.round(duration >= 1e3 ? duration / 1e3 : duration));
    const h3 = Math.floor(totalSeconds / 3600);
    const m3 = Math.floor((totalSeconds % 3600) / 60);
    const s5 = totalSeconds % 60;
    return h3 > 0
      ? `${h3}:${String(m3).padStart(2, '0')}:${String(s5).padStart(2, '0')}`
      : `${String(m3).padStart(2, '0')}:${String(s5).padStart(2, '0')}`;
  };
  var FAILURE_REASON_LABELS = {
    missing_media: '缺少媒体信息',
    no_valid_media: '未找到可下载的媒体资源',
    no_cover: '未找到封面地址',
    cover_download_failed: '封面下载失败',
    download_failed: '下载失败',
    cache_miss: '缓存中未找到作品',
    unexpected_error: '下载任务异常'
  };
  var LazyCover = ({src}) => {
    const ref = A2(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      if (!('IntersectionObserver' in window)) {
        setVisible(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setVisible(true);
            observer.disconnect();
          }
        },
        {
          rootMargin: '200px 0px'
        }
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, []);
    return jsx('img', {
      ref,
      src: visible ? src : void 0,
      className: profileJobStyles.cover + (visible ? '' : ' ' + profileJobStyles.coverHidden),
      loading: 'lazy',
      decoding: 'async',
      alt: ''
    });
  };
  var ProfileJobModalApp = ({downloadManager, onClose}) => {
    const [snap, setSnap] = useState(() => downloadManager.getSnapshot());
    const [searchText, setSearchText] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortMode, setSortMode] = useState('time_desc');
    const [activeTab, setActiveTab] = useState('list');
    const toggleSort = (field) => {
      setSortMode((prev) => {
        const currentField = prev.replace(/_(asc|desc)$/, '');
        if (currentField === field) return prev.endsWith('_asc') ? `${field}_desc` : `${field}_asc`;
        return `${field}_desc`;
      });
    };
    const sortArrow = (field) => {
      const currentField = sortMode.replace(/_(asc|desc)$/, '');
      if (currentField !== field) return '↕';
      return sortMode.endsWith('_asc') ? '↑' : '↓';
    };
    const arrowClass = (field) =>
      profileJobStyles.thArrow + (sortMode.startsWith(field) ? ' ' + profileJobStyles.thArrowActive : '');
    const [concurrency, setConcurrency] = useState(1);
    const logRef = A2(null);
    const buildMediaList = q2(() => {
      const knownIds = downloadManager.jobState?.knownIds || [];
      return knownIds
        .map((id) => {
          const media = downloadManager.dataService.feedMediaCache.get(id);
          if (!media) return null;
          const downloaded = downloadManager.jobState?.downloadedIds?.includes(id) || false;
          const failed = downloadManager.jobState?.failedItems?.[id];
          const coverDownloaded = downloadManager.jobState?.coverDownloadedIds?.includes(id) || false;
          const coverFailed = downloadManager.jobState?.coverFailedItems?.[id];
          const bitRateList = media.video?.bitRateList || [];
          const maxSize = bitRateList.reduce(
            (max, item) => Math.max(max, item.dataSize || 0),
            media.video?.dataSize || 0
          );
          const albumSize = (media.images || []).reduce((sum, img) => sum + (img.video?.dataSize || 0), 0);
          return {
            awemeId: id,
            media,
            downloaded,
            failed,
            coverDownloaded,
            coverFailed,
            selected: downloadManager.selectedIds.has(id),
            type: media.images && media.images.length > 0 ? 'album' : 'video',
            sortTime: media.createTime || 0,
            sortSize: Math.max(maxSize, albumSize),
            sortDuration: media.video?.duration || 0,
            sortImages: media.images?.length || 0
          };
        })
        .filter(Boolean);
    }, [downloadManager]);
    const refresh = q2(() => {
      setSnap(downloadManager.getSnapshot());
      setRawMediaList(buildMediaList());
    }, [buildMediaList, downloadManager]);
    const [rawMediaList, setRawMediaList] = useState([]);
    useEffect(() => {
      refresh();
      const off1 = downloadManager.on('stateChanged', refresh);
      const off2 = downloadManager.on('countsUpdated', refresh);
      const off3 = downloadManager.on('jobLog', refresh);
      const timer = setInterval(refresh, 2e3);
      return () => {
        off1();
        off2();
        off3();
        clearInterval(timer);
      };
    }, [refresh]);
    useEffect(() => {
      if (snap.jobRunning || snap.jobStatus === 'running') setActiveTab('job');
    }, [snap.jobRunning, snap.jobStatus]);
    useEffect(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [snap.jobLog.length]);
    const filteredList = T2(() => {
      let list = rawMediaList;
      if (typeFilter !== 'all') list = list.filter((item) => item.type === typeFilter);
      if (statusFilter === 'downloaded') list = list.filter((item) => item.downloaded);
      else if (statusFilter === 'not_downloaded') list = list.filter((item) => !item.downloaded);
      else if (statusFilter === 'cover_downloaded') list = list.filter((item) => item.coverDownloaded);
      else if (statusFilter === 'cover_not_downloaded') list = list.filter((item) => !item.coverDownloaded);
      if (searchText.trim()) {
        const q3 = searchText.toLowerCase().trim();
        list = list.filter((item) => {
          const desc = (item.media.desc || '').toLowerCase();
          const shortId = MediaHandler.toShortId(item.awemeId).toLowerCase();
          return desc.includes(q3) || item.awemeId.toLowerCase().includes(q3) || shortId.includes(q3);
        });
      }
      const sortKey = sortMode.replace(/_(asc|desc)$/, '');
      const direction = sortMode.endsWith('_asc') ? 1 : -1;
      const keyMap = {
        time: 'sortTime',
        size: 'sortSize',
        duration: 'sortDuration',
        images: 'sortImages'
      };
      const sortField = keyMap[sortKey];
      return [...list].sort((a3, b) => ((a3[sortField] || 0) - (b[sortField] || 0)) * direction);
    }, [rawMediaList, searchText, typeFilter, statusFilter, sortMode]);
    const isFilteredAllSelected = filteredList.length > 0 && filteredList.every((item) => item.selected);
    const handleSelectAll = (checked) => {
      downloadManager.markSelectMany(
        filteredList.map((item) => item.awemeId),
        checked
      );
    };
    const handleSelectRow = (awemeId, checked) => {
      downloadManager.markSelect(awemeId, checked);
    };
    const startJob = async (downloadType2 = 'content', runConcurrency = concurrency) => {
      try {
        await downloadManager.startJob(downloadType2, runConcurrency);
      } catch (err) {
        alert(err.message || err);
      }
    };
    const updateConcurrency = (value) => {
      setConcurrency(clampConcurrency(value));
    };
    const resumeJob = async () => {
      try {
        await downloadManager.resumeJob();
      } catch (err) {
        alert(err.message || err);
      }
    };
    const isJobView =
      snap.jobRunning || snap.jobStatus === 'running' || snap.jobStatus === 'paused' || snap.jobStatus === 'completed';
    const downloadType = snap.downloadType;
    const progressCount = Object.values(snap.itemStatuses || {}).filter((status) => status === 'success').length;
    const progressTotal = Math.max(snap.counts.selected, 1);
    const failedSections = [
      {
        title: '内容失败详情',
        count: snap.counts.failed,
        items: downloadManager.jobState?.failedItems
      },
      {
        title: '封面失败详情',
        count: snap.counts.coverFailed,
        items: downloadManager.jobState?.coverFailedItems
      }
    ].filter((section) => section.count > 0);
    const logStatusClass = (status) => {
      if (status === 'running') return profileJobStyles.logStatusRunning;
      if (status === 'success') return profileJobStyles.logStatusSuccess;
      if (status === 'failed') return profileJobStyles.logStatusFailed;
      return profileJobStyles.logStatusInfo;
    };
    const logStatusLabel = (status) => {
      if (status === 'running') return '下载中';
      if (status === 'success') return '成功';
      if (status === 'failed') return '失败';
      return '信息';
    };
    return jsx('div', {
      className: profileJobStyles.overlay,
      onClick: onClose,
      children: jsx('div', {
        className: profileJobStyles.modal,
        onClick: (e3) => e3.stopPropagation(),
        children: [
          jsx('div', {
            className: profileJobStyles.header,
            children: [
              jsx('h3', {
                className: profileJobStyles.title,
                children: ['批量下载 - ', snap.profileName]
              }),
              jsx('div', {
                className: profileJobStyles.statusText,
                children: ['状态: ', snap.statusLabel || '待命']
              }),
              jsx('button', {
                className: profileJobStyles.closeBtn,
                onClick: onClose,
                children: 'x'
              })
            ]
          }),
          jsx('div', {
            className: profileJobStyles.tabs,
            children: [
              jsx('button', {
                className: profileJobStyles.tab + (activeTab === 'list' ? ' ' + profileJobStyles.tabActive : ''),
                onClick: () => setActiveTab('list'),
                children: '作品列表'
              }),
              jsx('button', {
                className: profileJobStyles.tab + (activeTab === 'job' ? ' ' + profileJobStyles.tabActive : ''),
                onClick: () => setActiveTab('job'),
                children: '任务进度'
              }),
              jsx('button', {
                className: profileJobStyles.tab + (activeTab === 'failed' ? ' ' + profileJobStyles.tabActive : ''),
                onClick: () => setActiveTab('failed'),
                children: ['失败详情 (', snap.counts.failed + snap.counts.coverFailed, ')']
              })
            ]
          }),
          activeTab === 'list'
            ? jsx(Fragment, {
                children: [
                  jsx('div', {
                    className: profileJobStyles.statsBar,
                    children: [
                      jsx('span', {
                        children: ['已发现: ', snap.counts.known]
                      }),
                      jsx('span', {
                        children: ['内容已下载: ', snap.counts.downloaded]
                      }),
                      jsx('span', {
                        children: ['内容失败: ', snap.counts.failed]
                      }),
                      jsx('span', {
                        children: ['封面已下载: ', snap.counts.coverDownloaded]
                      }),
                      jsx('span', {
                        children: ['封面失败: ', snap.counts.coverFailed]
                      }),
                      jsx('span', {
                        children: ['已选: ', snap.counts.selected]
                      })
                    ]
                  }),
                  jsx('div', {
                    className: profileJobStyles.filterBar,
                    children: jsx('input', {
                      type: 'text',
                      placeholder: '搜索描述...',
                      className: profileJobStyles.searchInput,
                      value: searchText,
                      onInput: (e3) => setSearchText(e3.target.value)
                    })
                  }),
                  jsx('div', {
                    className: profileJobStyles.tableContainer,
                    children: [
                      jsx('table', {
                        className: profileJobStyles.table,
                        children: [
                          jsx('thead', {
                            children: jsx('tr', {
                              children: [
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '40px'
                                  },
                                  children: jsx('input', {
                                    type: 'checkbox',
                                    className: profileJobStyles.checkbox,
                                    checked: isFilteredAllSelected,
                                    onChange: (e3) => handleSelectAll(e3.target.checked)
                                  })
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '60px'
                                  },
                                  children: '封面'
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  children: '描述'
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '110px'
                                  },
                                  children: jsx('select', {
                                    className: profileJobStyles.typeFilterSelect,
                                    value: typeFilter,
                                    onChange: (e3) => setTypeFilter(e3.target.value),
                                    children: [
                                      jsx('option', {
                                        value: 'all',
                                        children: '类型: 全部'
                                      }),
                                      jsx('option', {
                                        value: 'video',
                                        children: '视频'
                                      }),
                                      jsx('option', {
                                        value: 'album',
                                        children: '图集'
                                      })
                                    ]
                                  })
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '150px'
                                  },
                                  children: jsx('select', {
                                    className: profileJobStyles.typeFilterSelect,
                                    value: statusFilter,
                                    onChange: (e3) => setStatusFilter(e3.target.value),
                                    children: [
                                      jsx('option', {
                                        value: 'all',
                                        children: '状态: 全部'
                                      }),
                                      jsx('option', {
                                        value: 'downloaded',
                                        children: '内容已下载'
                                      }),
                                      jsx('option', {
                                        value: 'not_downloaded',
                                        children: '内容未下载'
                                      }),
                                      jsx('option', {
                                        value: 'cover_downloaded',
                                        children: '封面已下载'
                                      }),
                                      jsx('option', {
                                        value: 'cover_not_downloaded',
                                        children: '封面未下载'
                                      })
                                    ]
                                  })
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '90px'
                                  },
                                  children: jsx('button', {
                                    className: profileJobStyles.thBtn,
                                    onClick: () => toggleSort('size'),
                                    children: [
                                      '文件大小 ',
                                      jsx('span', {
                                        className: arrowClass('size'),
                                        children: sortArrow('size')
                                      })
                                    ]
                                  })
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '90px'
                                  },
                                  children: jsx('button', {
                                    className: profileJobStyles.thBtn,
                                    onClick: () => toggleSort('duration'),
                                    children: [
                                      '视频时长 ',
                                      jsx('span', {
                                        className: arrowClass('duration'),
                                        children: sortArrow('duration')
                                      })
                                    ]
                                  })
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '80px'
                                  },
                                  children: jsx('button', {
                                    className: profileJobStyles.thBtn,
                                    onClick: () => toggleSort('images'),
                                    children: [
                                      '图集数量 ',
                                      jsx('span', {
                                        className: arrowClass('images'),
                                        children: sortArrow('images')
                                      })
                                    ]
                                  })
                                }),
                                jsx('th', {
                                  className: profileJobStyles.th,
                                  style: {
                                    width: '100px'
                                  },
                                  children: jsx('button', {
                                    className: profileJobStyles.thBtn,
                                    onClick: () => toggleSort('time'),
                                    children: [
                                      '发布时间 ',
                                      jsx('span', {
                                        className: arrowClass('time'),
                                        children: sortArrow('time')
                                      })
                                    ]
                                  })
                                })
                              ]
                            })
                          }),
                          jsx('tbody', {
                            children: filteredList.map((item) => {
                              const media = item.media;
                              const coverUrl = getBestCoverUrl(media) || '';
                              const desc = media.desc || '(无描述)';
                              const createDate = media.createTime
                                ? new Date(media.createTime * 1e3).toLocaleDateString()
                                : '-';
                              const fileSizeText = formatModalFileSize(item.sortSize);
                              const durationText = formatModalDuration(item.sortDuration);
                              const imageCountText = item.type === 'album' ? `${item.sortImages}张` : '-';
                              const typeLabel = item.type === 'album' ? '图集' : '视频';
                              let contentStatusCls = profileJobStyles.statusPending;
                              let contentStatusText = '内容 待下载';
                              if (item.downloaded) {
                                contentStatusCls = profileJobStyles.statusDownloaded;
                                contentStatusText = '内容 已下载';
                              } else if (item.failed) {
                                contentStatusCls = profileJobStyles.statusFailed;
                                contentStatusText = '内容 失败(' + item.failed.count + ')';
                              }
                              let coverStatusCls = profileJobStyles.statusPending;
                              let coverStatusText = '封面 待下载';
                              if (item.coverDownloaded) {
                                coverStatusCls = profileJobStyles.statusDownloaded;
                                coverStatusText = '封面 已下载';
                              } else if (item.coverFailed) {
                                coverStatusCls = profileJobStyles.statusFailed;
                                coverStatusText = '封面 失败(' + item.coverFailed.count + ')';
                              }
                              return jsx(
                                'tr',
                                {
                                  children: [
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: jsx('input', {
                                        type: 'checkbox',
                                        className: profileJobStyles.checkbox,
                                        checked: item.selected,
                                        onChange: (e3) => handleSelectRow(item.awemeId, e3.target.checked)
                                      })
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children:
                                        coverUrl &&
                                        jsx(LazyCover, {
                                          src: coverUrl
                                        })
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: [
                                        jsx('div', {
                                          className: profileJobStyles.desc,
                                          title: desc,
                                          children: desc
                                        }),
                                        jsx('div', {
                                          className: profileJobStyles.idText,
                                          children: ['ID: ', item.awemeId]
                                        })
                                      ]
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: jsx('span', {
                                        className: profileJobStyles.typeBadge,
                                        children: typeLabel
                                      })
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: jsx('div', {
                                        className: profileJobStyles.statusGroup,
                                        children: [
                                          jsx('span', {
                                            className: profileJobStyles.statusBadge + ' ' + contentStatusCls,
                                            children: contentStatusText
                                          }),
                                          jsx('span', {
                                            className: profileJobStyles.statusBadge + ' ' + coverStatusCls,
                                            children: coverStatusText
                                          })
                                        ]
                                      })
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: fileSizeText
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: durationText
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: imageCountText
                                    }),
                                    jsx('td', {
                                      className: profileJobStyles.td,
                                      children: createDate
                                    })
                                  ]
                                },
                                item.awemeId
                              );
                            })
                          })
                        ]
                      }),
                      filteredList.length === 0 &&
                        jsx('div', {
                          style: 'text-align:center;padding:40px;color:rgba(255,255,255,0.5);',
                          children:
                            rawMediaList.length === 0 ? '暂无作品数据，请先滚动主页加载作品。' : '没有匹配的搜索结果。'
                        })
                    ]
                  }),
                  jsx('div', {
                    className: profileJobStyles.footer,
                    children:
                      '提示：勾选作品后点击“开始下载”下载内容，点击“下载封面”下载封面。使用类型筛选快速定位内容。'
                  }),
                  jsx('div', {
                    className: profileJobStyles.actionBar,
                    children: [
                      jsx('button', {
                        className: profileJobStyles.btn,
                        onClick: () => handleSelectAll(!isFilteredAllSelected),
                        disabled: filteredList.length === 0,
                        children: isFilteredAllSelected ? '取消全选' : '全选'
                      }),
                      jsx('select', {
                        className: profileJobStyles.typeFilterSelect,
                        value: concurrency,
                        onChange: (e3) => updateConcurrency(Number(e3.target.value)),
                        children: [1, 2, 3, 4, 5].map((n2) =>
                          jsx(
                            'option',
                            {
                              value: n2,
                              children: ['并发 ', n2]
                            },
                            n2
                          )
                        )
                      }),
                      jsx('button', {
                        className: profileJobStyles.btnPrimary,
                        onClick: () => startJob('content', concurrency),
                        disabled: snap.counts.selected === 0,
                        children: '开始下载'
                      }),
                      jsx('button', {
                        className: profileJobStyles.btn,
                        onClick: () => startJob('cover', concurrency),
                        disabled: snap.counts.selected === 0,
                        children: '下载封面'
                      }),
                      jsx('button', {
                        className: profileJobStyles.btn,
                        onClick: () => {
                          if (confirm('确定重置当前作者的下载记录吗？这将清除已下载和失败记录。'))
                            downloadManager.resetState();
                        },
                        children: '重置'
                      }),
                      jsx('button', {
                        className: profileJobStyles.btn,
                        onClick: () => downloadManager.mediaHandler.open_config_modal(),
                        children: '设置'
                      }),
                      jsx('button', {
                        className: profileJobStyles.btn,
                        onClick: onClose,
                        children: '关闭'
                      })
                    ]
                  })
                ]
              })
            : activeTab === 'job'
              ? isJobView
                ? jsx('div', {
                    className: profileJobStyles.jobContent,
                    children: [
                      jsx('div', {
                        className: profileJobStyles.jobSummary,
                        children: [
                          jsx('span', {
                            children: ['下载类型: ', downloadType === 'cover' ? '封面' : '内容']
                          }),
                          jsx('span', {
                            children: ['并发: ', snap.concurrency || concurrency]
                          }),
                          jsx('span', {
                            children: ['已选: ', snap.counts.selected]
                          }),
                          jsx('span', {
                            children: ['成功: ', progressCount]
                          }),
                          jsx('span', {
                            children: [
                              '失败: ',
                              downloadType === 'cover' ? snap.counts.coverFailed : snap.counts.failed
                            ]
                          })
                        ]
                      }),
                      jsx('div', {
                        className: profileJobStyles.progressSection,
                        children: [
                          jsx('div', {
                            className: profileJobStyles.progressLabel,
                            children: [
                              jsx('span', {
                                children: '下载进度'
                              }),
                              jsx('span', {
                                children: [progressCount, '/', progressTotal]
                              })
                            ]
                          }),
                          jsx('div', {
                            className: profileJobStyles.progressBarContainer,
                            children: jsx('div', {
                              className: profileJobStyles.progressBarFill,
                              style: {
                                width: (progressCount / progressTotal) * 100 + '%'
                              }
                            })
                          }),
                          jsx('div', {
                            className: profileJobStyles.squareContainer,
                            children: Object.entries(snap.itemStatuses || {}).map(([id, status]) =>
                              jsx(
                                'div',
                                {
                                  className:
                                    profileJobStyles.square +
                                    (status === 'success'
                                      ? ' ' + profileJobStyles.squareSuccess
                                      : status === 'failed'
                                        ? ' ' + profileJobStyles.squareFailed
                                        : status === 'running'
                                          ? ' ' + profileJobStyles.squareRunning
                                          : ' ' + profileJobStyles.squarePending),
                                  title: id
                                },
                                id
                              )
                            )
                          }),
                          jsx('div', {
                            className: profileJobStyles.progressLabel,
                            children: jsx('span', {
                              children: '黑=等待 黄=下载中 绿=成功 红=失败'
                            })
                          })
                        ]
                      }),
                      jsx('div', {
                        className: profileJobStyles.logContainer,
                        ref: logRef,
                        children:
                          snap.jobLog.length === 0
                            ? jsx('div', {
                                className: profileJobStyles.emptyLog,
                                children: '暂无日志'
                              })
                            : jsx('ul', {
                                className: profileJobStyles.logList,
                                children: snap.jobLog.map((log, index) =>
                                  jsx(
                                    'li',
                                    {
                                      className: profileJobStyles.logItem,
                                      children: [
                                        jsx('span', {
                                          className: profileJobStyles.logTime,
                                          children: new Date(log.time).toLocaleTimeString()
                                        }),
                                        jsx('span', {
                                          className: profileJobStyles.logType,
                                          children: log.type === 'cover' ? '封面' : '内容'
                                        }),
                                        jsx('span', {
                                          className: profileJobStyles.logDesc,
                                          children: log.desc || log.awemeId || log.message
                                        }),
                                        jsx('span', {
                                          className: logStatusClass(log.status),
                                          children: logStatusLabel(log.status)
                                        })
                                      ]
                                    },
                                    index
                                  )
                                )
                              })
                      }),
                      jsx('div', {
                        className: profileJobStyles.actionBar,
                        children: snap.jobRunning
                          ? jsx(Fragment, {
                              children: [
                                jsx('button', {
                                  className: profileJobStyles.btn,
                                  onClick: () => downloadManager.pauseJob(),
                                  disabled: snap.jobStopRequested,
                                  children: '暂停'
                                }),
                                jsx('button', {
                                  className: profileJobStyles.btn,
                                  onClick: () => downloadManager.endJob(),
                                  children: '结束'
                                })
                              ]
                            })
                          : snap.jobStatus === 'paused'
                            ? jsx(Fragment, {
                                children: [
                                  jsx('button', {
                                    className: profileJobStyles.btnPrimary,
                                    onClick: resumeJob,
                                    children: '继续'
                                  }),
                                  jsx('button', {
                                    className: profileJobStyles.btn,
                                    onClick: () => downloadManager.endJob(),
                                    children: '结束'
                                  })
                                ]
                              })
                            : jsx(Fragment, {
                                children: [
                                  jsx('button', {
                                    className: profileJobStyles.btn,
                                    onClick: () => downloadManager.endJob(),
                                    children: '结束'
                                  }),
                                  jsx('button', {
                                    className: profileJobStyles.btn,
                                    onClick: onClose,
                                    children: '关闭'
                                  })
                                ]
                              })
                      }),
                      jsx('div', {
                        className: profileJobStyles.footer,
                        children: '关闭弹窗不会中断后台下载；结束后可回到选择阶段。'
                      })
                    ]
                  })
                : jsx('div', {
                    className: profileJobStyles.emptyLog,
                    style: {
                      flexGrow: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    },
                    children: '暂无任务进度'
                  })
              : jsx('div', {
                  className: profileJobStyles.tableContainer,
                  children: [
                    failedSections.length === 0
                      ? jsx('div', {
                          className: profileJobStyles.failEmpty,
                          children: '暂无失败记录'
                        })
                      : failedSections.map((section) =>
                          jsx(
                            'div',
                            {
                              className: profileJobStyles.failSection,
                              children: [
                                jsx('h4', {
                                  className: profileJobStyles.failTitle,
                                  children: section.title
                                }),
                                jsx('table', {
                                  className: profileJobStyles.failTable,
                                  children: [
                                    jsx('thead', {
                                      children: jsx('tr', {
                                        children: [
                                          jsx('th', {
                                            className: profileJobStyles.failTh,
                                            children: '类型'
                                          }),
                                          jsx('th', {
                                            className: profileJobStyles.failTh,
                                            children: 'ID'
                                          }),
                                          jsx('th', {
                                            className: profileJobStyles.failTh,
                                            children: '描述'
                                          }),
                                          jsx('th', {
                                            className: profileJobStyles.failTh,
                                            children: '原因'
                                          }),
                                          jsx('th', {
                                            className: profileJobStyles.failTh,
                                            children: '错误信息'
                                          }),
                                          jsx('th', {
                                            className: profileJobStyles.failTh,
                                            children: '次数'
                                          }),
                                          jsx('th', {
                                            className: profileJobStyles.failTh,
                                            children: '时间'
                                          })
                                        ]
                                      })
                                    }),
                                    jsx('tbody', {
                                      children: Object.entries(section.items || {})
                                        .sort((a3, b) => (b[1].updatedAt || 0) - (a3[1].updatedAt || 0))
                                        .map(([id, info]) =>
                                          jsx(
                                            'tr',
                                            {
                                              children: [
                                                jsx('td', {
                                                  className: profileJobStyles.failTd,
                                                  children: section.title.includes('封面') ? '封面' : '内容'
                                                }),
                                                jsx('td', {
                                                  className: profileJobStyles.failTd,
                                                  children: jsx('div', {
                                                    className: profileJobStyles.failId,
                                                    children: id
                                                  })
                                                }),
                                                jsx('td', {
                                                  className: profileJobStyles.failTd,
                                                  children: jsx('div', {
                                                    className: profileJobStyles.failDesc,
                                                    title: info.desc,
                                                    children: info.desc || '-'
                                                  })
                                                }),
                                                jsx('td', {
                                                  className: profileJobStyles.failTd,
                                                  children: info.reason
                                                    ? FAILURE_REASON_LABELS[info.reason] || info.reason
                                                    : '-'
                                                }),
                                                jsx('td', {
                                                  className: profileJobStyles.failTd,
                                                  children: jsx('div', {
                                                    className: profileJobStyles.failMessage,
                                                    children: info.message || info.reason || '-'
                                                  })
                                                }),
                                                jsx('td', {
                                                  className: profileJobStyles.failTd,
                                                  children: info.count
                                                }),
                                                jsx('td', {
                                                  className: profileJobStyles.failTd,
                                                  children: info.updatedAt
                                                    ? new Date(info.updatedAt).toLocaleString()
                                                    : '-'
                                                })
                                              ]
                                            },
                                            id
                                          )
                                        )
                                    })
                                  ]
                                })
                              ]
                            },
                            section.title
                          )
                        ),
                    jsx('div', {
                      className: profileJobStyles.actionBar,
                      children: jsx('button', {
                        className: profileJobStyles.btn,
                        onClick: onClose,
                        children: '关闭'
                      })
                    })
                  ]
                })
        ]
      })
    });
  };
  // ─── src/ui/FloatingPanelUI.tsx · 作者主页浮动面板 UI ──────────────
  var floatingPanelCss = createCSS();
  var floatingPanelStyles = {
    panelClosed: floatingPanelCss({
      position: 'fixed',
      right: '24px',
      bottom: '80px',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing.md
    }),
    panelOpen: floatingPanelCss({
      position: 'fixed',
      right: '24px',
      bottom: '80px',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing.md,
      minWidth: '240px'
    }),
    fab: floatingPanelCss({
      position: 'fixed',
      zIndex: 999999,
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      border: 'none',
      background: theme.colors.primary,
      color: '#fff',
      fontSize: '12px',
      cursor: 'grab',
      touchAction: 'none',
      userSelect: 'none',
      boxShadow: '0 4px 12px rgba(254,44,85,0.4)',
      transition: 'box-shadow 0.2s'
    }),
    card: floatingPanelCss({
      position: 'fixed',
      zIndex: 999999,
      overflowY: 'auto',
      boxSizing: 'border-box',
      width: '372px',
      maxWidth: 'calc(100vw - 32px)',
      background: 'rgba(18,18,20,0.94)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '16px',
      padding: '18px',
      color: '#fff',
      fontSize: '13.5px',
      fontFamily: 'sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
    }),
    title: floatingPanelCss({
      margin: '0 0 14px',
      fontSize: '16px',
      fontWeight: 600
    }),
    row: floatingPanelCss({
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)'
    }),
    label: floatingPanelCss({
      color: 'rgba(255,255,255,0.6)'
    }),
    value: floatingPanelCss({
      color: '#fff',
      fontWeight: 500
    }),
    stats: floatingPanelCss({
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 10px',
      marginTop: '8px',
      fontSize: '12px',
      lineHeight: 1.4,
      color: 'rgba(255,255,255,0.55)'
    }),
    progressSection: floatingPanelCss({
      marginTop: '10px'
    }),
    progressHeader: floatingPanelCss({
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '6px',
      fontSize: '12px',
      color: 'rgba(255,255,255,0.6)'
    }),
    progressBar: floatingPanelCss({
      height: '6px',
      background: 'rgba(255,255,255,0.1)',
      borderRadius: '3px',
      overflow: 'hidden'
    }),
    progressFill: floatingPanelCss({
      height: '100%',
      background: theme.colors.primary,
      borderRadius: '3px',
      transition: 'width 0.3s'
    }),
    select: floatingPanelCss({
      padding: '7px 10px',
      borderRadius: '20px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      fontSize: '12px',
      cursor: 'pointer',
      outline: 'none',
      minWidth: '92px',
      '& option': {
        background: '#2c2c2e',
        color: '#fff'
      },
      '&:disabled': {
        opacity: 0.5,
        cursor: 'not-allowed'
      }
    }),
    btnGroup: floatingPanelCss({
      display: 'flex',
      gap: '8px',
      marginTop: '12px',
      flexWrap: 'wrap'
    }),
    btn: floatingPanelCss({
      flex: '1 1 auto',
      padding: '9px 12px',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '20px',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '12px',
      textAlign: 'center',
      transition: '0.2s',
      minWidth: '78px',
      wordBreak: 'keep-all',
      whiteSpace: 'nowrap'
    }),
    btnPrimary: floatingPanelCss({
      flex: '1 1 auto',
      padding: '9px 12px',
      border: 'none',
      borderRadius: '20px',
      background: theme.colors.primary,
      color: '#fff',
      cursor: 'pointer',
      fontSize: '12px',
      textAlign: 'center',
      transition: '0.2s',
      minWidth: '78px',
      wordBreak: 'keep-all',
      whiteSpace: 'nowrap'
    }),
    btnDanger: floatingPanelCss({
      flex: '1 1 auto',
      padding: '9px 12px',
      border: '1px solid rgba(255,77,79,0.5)',
      borderRadius: '20px',
      background: 'rgba(255,77,79,0.15)',
      color: '#ff6b6b',
      cursor: 'pointer',
      fontSize: '12px',
      textAlign: 'center',
      transition: '0.2s',
      minWidth: '78px',
      wordBreak: 'keep-all',
      whiteSpace: 'nowrap'
    })
  };
  var PANEL_OPEN_KEY = '__douyin-dl-profile-panel-open__';
  var readPanelOpen = () => {
    try {
      const saved = localStorage.getItem(PANEL_OPEN_KEY);
      if (saved !== null) return saved === '1';
    } catch {}
    return Config.global.features.enable_profile_downloader;
  };
  var writePanelOpen = (open) => {
    try {
      localStorage.setItem(PANEL_OPEN_KEY, open ? '1' : '0');
    } catch {}
    Config.global.features.enable_profile_downloader = open;
    Config.global.save();
  };
  var floatingPanelEagleStyles = {
    eagleBox: floatingPanelCss({
      marginTop: '10px',
      paddingTop: '10px',
      borderTop: '1px solid rgba(255,255,255,0.08)'
    }),
    eagleHead: floatingPanelCss({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '6px',
      fontSize: '11px',
      color: 'rgba(255,255,255,0.6)',
      marginBottom: '6px'
    }),
    eagleState: floatingPanelCss({
      color: 'rgba(255,255,255,0.9)',
      maxWidth: '150px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }),
    eagleRow: floatingPanelCss({
      display: 'flex',
      gap: '6px'
    }),
    eagleRowSecond: floatingPanelCss({
      marginTop: '6px'
    }),
    miniBtn: floatingPanelCss({
      flex: 1,
      padding: '5px 8px',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '14px',
      background: 'rgba(255,255,255,0.06)',
      color: '#fff',
      fontSize: '11px',
      cursor: 'pointer'
    }),
    miniBtnOn: floatingPanelCss({
      borderColor: 'rgba(64,150,255,0.65)',
      background: 'rgba(64,150,255,0.22)',
      color: '#fff'
    }),
    miniInput: floatingPanelCss({
      width: '100%',
      boxSizing: 'border-box',
      marginTop: '6px',
      padding: '5px 8px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      fontSize: '11px',
      outline: 'none'
    }),
    scrollBox: floatingPanelCss({
      maxHeight: '150px',
      overflowY: 'auto',
      marginTop: '6px',
      padding: '4px',
      background: 'rgba(0,0,0,0.28)',
      borderRadius: '8px'
    }),
    row: floatingPanelCss({
      padding: '3px 6px',
      borderRadius: '4px',
      fontSize: '11px',
      color: 'rgba(255,255,255,0.85)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      '&:hover': {
        background: 'rgba(255,255,255,0.08)'
      }
    }),
    rowActive: floatingPanelCss({
      background: 'rgba(64,150,255,0.22)',
      color: '#fff'
    }),
    tagBox: floatingPanelCss({
      maxHeight: '140px',
      overflowY: 'auto',
      marginTop: '6px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px',
      padding: '4px',
      background: 'rgba(0,0,0,0.28)',
      borderRadius: '8px'
    }),
    tagOpt: floatingPanelCss({
      padding: '2px 8px',
      borderRadius: '12px',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: 'rgba(255,255,255,0.75)',
      fontSize: '11px',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }),
    tagOptActive: floatingPanelCss({
      background: 'rgba(254,44,85,0.25)',
      borderColor: theme.colors.primary,
      color: '#fff'
    }),
    tagActions: floatingPanelCss({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '6px'
    }),
    linkBtn: floatingPanelCss({
      color: theme.colors.primary,
      fontSize: '11px',
      cursor: 'pointer',
      textDecoration: 'underline'
    }),
    emptyHint: floatingPanelCss({
      fontSize: '10px',
      color: 'rgba(255,255,255,0.45)',
      marginTop: '6px',
      lineHeight: 1.5
    }),
    quickBtn: floatingPanelCss({
      width: '100%',
      marginTop: '8px',
      padding: '7px 10px',
      border: '1px solid rgba(64,150,255,0.55)',
      borderRadius: '20px',
      background: 'rgba(64,150,255,0.16)',
      color: '#fff',
      fontSize: '12px',
      cursor: 'pointer',
      '&:disabled': {
        opacity: 0.5,
        cursor: 'not-allowed'
      }
    }),
    quickWrap: floatingPanelCss({
      position: 'fixed',
      right: '24px',
      bottom: '96px',
      zIndex: 999999
    }),
    quickFab: floatingPanelCss({
      padding: '10px 16px',
      border: 'none',
      borderRadius: '22px',
      background: theme.colors.primary,
      color: '#fff',
      fontSize: '13px',
      cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
      '&:disabled': {
        opacity: 0.6,
        cursor: 'not-allowed'
      }
    })
  };
  var useDraggableFab = (storageKey, defaultPos) => {
    const [pos, setPos] = useState(() => {
      let saved = null;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) saved = JSON.parse(raw);
      } catch (err) {
        saved = null;
      }
      const base = saved && typeof saved.x === 'number' && typeof saved.y === 'number' ? saved : defaultPos;
      return {
        x: Math.min(Math.max(base.x, 8), Math.max(8, window.innerWidth - 64)),
        y: Math.min(Math.max(base.y, 8), Math.max(8, window.innerHeight - 64))
      };
    });
    const posRef = A2(pos);
    const draggedRef = A2(false);
    posRef.current = pos;
    const onPointerDown = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startPos = {
        x: posRef.current.x,
        y: posRef.current.y
      };
      let moved = false;
      const onMove = (e3) => {
        const dx = e3.clientX - startX;
        const dy = e3.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true;
        const next = {
          x: Math.min(Math.max(startPos.x + dx, 8), Math.max(8, window.innerWidth - 64)),
          y: Math.min(Math.max(startPos.y + dy, 8), Math.max(8, window.innerHeight - 64))
        };
        posRef.current = next;
        setPos(next);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (!moved) return;
        draggedRef.current = true;
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
        try {
          localStorage.setItem(storageKey, JSON.stringify(posRef.current));
        } catch (err) {}
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    };
    return {
      pos,
      onPointerDown,
      draggedRef
    };
  };
  var FloatingPanelApp = ({dataService, downloadManager, onOpenSettings}) => {
    const [exp, setExp] = useState(readPanelOpen);
    const [snap, setSnap] = useState(() => downloadManager.getSnapshot());
    const [showJob, setShowJob] = useState(false);
    const [concurrency, setConcurrency] = useState(snap.concurrency || 1);
    useEffect(() => {
      const off = downloadManager.on('stateChanged', () => setSnap(downloadManager.getSnapshot()));
      const off2 = downloadManager.on('countsUpdated', () => setSnap(downloadManager.getSnapshot()));
      return () => {
        off();
        off2();
      };
    }, []);
    useEffect(() => {
      setConcurrency(snap.concurrency || 1);
    }, [snap.concurrency]);
    // ── Eagle 推送目标：点按钮开弹层选择，选择后写入配置并持久化 ──
    const eagleCfg = () => (Config.global.features.downloader_config || {}).eagle || {};
    const [, setEagleTick] = useState(0);
    // 「存当前作品到 Eagle」按钮的进行中状态：点击后立刻变成「推送中...」并禁用，避免重复点击
    const [eaglePushing, setEaglePushing] = useState(false);
    const pushCurrentToEagle = async () => {
      if (eaglePushing) return;
      setEaglePushing(true);
      try {
        await downloadManager.mediaHandler.push_current_to_eagle();
      } finally {
        // 留一点点时间让「推送中...」可见，再恢复按钮
        setTimeout(() => setEaglePushing(false), 600);
      }
    };
    const patchEagle = (patch) => {
      const features = Config.global.features;
      const nextConfig = {
        ...(features.downloader_config || {})
      };
      nextConfig.eagle = {
        ...(nextConfig.eagle || {}),
        ...patch
      };
      features.downloader_config = nextConfig;
      Config.global.save();
      setEagleTick((v3) => v3 + 1);
    };
    const drag = useDraggableFab('dy-dl-fab-pos', {
      x: Math.max(8, window.innerWidth - 72),
      y: Math.max(8, window.innerHeight - 132)
    });
    if (!dataService.isProfilePage()) return null;
    const progressType = snap.downloadType;
    const progressCount = Object.values(snap.itemStatuses || {}).filter((status) => status === 'success').length;
    const progressTotal = Math.max(snap.counts.selected, 1);
    const progressPercent = Math.min(100, Math.round((progressCount / progressTotal) * 100));
    const startJob = async (downloadType = 'content', downloaderOverride = '') => {
      try {
        await downloadManager.startJob(downloadType, concurrency, downloaderOverride);
      } catch (err) {
        alert(err.message || err);
      }
    };
    const eagleCfgNow = eagleCfg();
    const selectedEagleTags = Array.isArray(eagleCfgNow.tags) ? eagleCfgNow.tags : [];
    const eagleAuthorAsTag = eagleCfgNow.author_as_tag === true;
    const eagleAuthorAsFolder = eagleCfgNow.author_as_folder === true;
    const eagleTargetLabel =
      (eagleCfgNow.folder_name || '根目录') +
      ' · ' +
      (selectedEagleTags.length > 0 ? selectedEagleTags.length + ' 个标签' : '无标签') +
      (eagleAuthorAsFolder ? ' · 作者文件夹' : '') +
      (eagleAuthorAsTag ? ' · 作者标签' : '');
    // FAB 定位：卡片跟随 FAB，优先在其下方展开，空间不足时改到上方（避免溢出视口）
    const FAB_SIZE = 44;
    const FAB_GAP = 12;
    const CARD_W = 372;
    const fabStyle = {
      left: drag.pos.x + 'px',
      top: drag.pos.y + 'px'
    };
    const cardLeft = Math.min(Math.max(drag.pos.x + FAB_SIZE - CARD_W, 8), Math.max(8, window.innerWidth - CARD_W - 8));
    const spaceBelow = window.innerHeight - (drag.pos.y + FAB_SIZE + FAB_GAP + 8);
    const cardStyle =
      spaceBelow >= 300
        ? {
            left: cardLeft + 'px',
            top: drag.pos.y + FAB_SIZE + FAB_GAP + 'px',
            maxHeight: Math.max(200, spaceBelow) + 'px'
          }
        : {
            left: cardLeft + 'px',
            bottom: window.innerHeight - drag.pos.y + FAB_GAP + 'px',
            maxHeight: Math.max(200, drag.pos.y - 16) + 'px'
          };
    return jsx(Fragment, {
      children: [
        exp &&
          jsx('div', {
            className: floatingPanelStyles.card,
            style: cardStyle,
            children: [
              jsx('h4', {
                className: floatingPanelStyles.title,
                children: snap.profileName || '作者主页'
              }),
              jsx('div', {
                className: floatingPanelEagleStyles.eagleBox,
                children: [
                  jsx('div', {
                    className: floatingPanelEagleStyles.eagleHead,
                    children: [
                      jsx('span', {
                        children: 'Eagle 目标'
                      }),
                      jsx('span', {
                        className: floatingPanelEagleStyles.eagleState,
                        title: eagleTargetLabel,
                        children: eagleTargetLabel
                      })
                    ]
                  }),
                  jsx('div', {
                    className: floatingPanelEagleStyles.eagleRow,
                    children: [
                      jsx('button', {
                        className: floatingPanelEagleStyles.miniBtn,
                        onClick: () =>
                          openEaglePicker({
                            mode: 'folder',
                            baseURL: eagleCfgNow.base_url,
                            selectedFolderId: eagleCfgNow.folder_id || '',
                            onChange: patchEagle
                          }),
                        children: '目录'
                      }),
                      jsx('button', {
                        className: floatingPanelEagleStyles.miniBtn,
                        onClick: () =>
                          openEaglePicker({
                            mode: 'tag',
                            baseURL: eagleCfgNow.base_url,
                            selectedTags: selectedEagleTags,
                            onChange: patchEagle
                          }),
                        children: '标签'
                      })
                    ]
                  }),
                  jsx('div', {
                    className: floatingPanelEagleStyles.eagleRow + ' ' + floatingPanelEagleStyles.eagleRowSecond,
                    children: [
                      jsx('button', {
                        className:
                          floatingPanelEagleStyles.miniBtn +
                          (eagleAuthorAsFolder ? ' ' + floatingPanelEagleStyles.miniBtnOn : ''),
                        title: '把作者昵称作为目标文件夹：在「目录」之下按作者名找同名文件夹，没有就自动新建',
                        onClick: () =>
                          patchEagle({
                            author_as_folder: !eagleAuthorAsFolder
                          }),
                        children: (eagleAuthorAsFolder ? '✓ ' : '') + '作者名为文件夹'
                      }),
                      jsx('button', {
                        className:
                          floatingPanelEagleStyles.miniBtn +
                          (eagleAuthorAsTag ? ' ' + floatingPanelEagleStyles.miniBtnOn : ''),
                        title: '推送时把作者昵称追加为素材标签',
                        onClick: () =>
                          patchEagle({
                            author_as_tag: !eagleAuthorAsTag
                          }),
                        children: (eagleAuthorAsTag ? '✓ ' : '') + '作者名为标签'
                      })
                    ]
                  }),
                  jsx('button', {
                    className: floatingPanelEagleStyles.quickBtn,
                    onClick: pushCurrentToEagle,
                    disabled: eaglePushing,
                    title: eaglePushing ? '正在推送到 Eagle...' : '把当前播放的作品（视频或整套图集）推送到 Eagle',
                    children: eaglePushing ? '⏳ 推送中...' : '存当前作品到 Eagle'
                  })
                ]
              }),
              jsx('div', {
                className: floatingPanelStyles.row,
                children: [
                  jsx('span', {
                    className: floatingPanelStyles.label,
                    children: '状态'
                  }),
                  jsx('span', {
                    className: floatingPanelStyles.value,
                    children: snap.statusLabel
                  })
                ]
              }),
              jsx('div', {
                className: floatingPanelStyles.stats,
                children: [
                  jsx('span', {
                    children: ['发现 ', snap.counts.known]
                  }),
                  jsx('span', {
                    children: ['已选 ', snap.counts.selected]
                  }),
                  jsx('span', {
                    children: ['内容 ', snap.counts.downloaded]
                  }),
                  jsx('span', {
                    children: ['封面 ', snap.counts.coverDownloaded]
                  }),
                  jsx('span', {
                    children: ['失败 ', snap.counts.failed + snap.counts.coverFailed]
                  })
                ]
              }),
              jsx('div', {
                className: floatingPanelStyles.progressSection,
                children: [
                  jsx('div', {
                    className: floatingPanelStyles.progressHeader,
                    children: [
                      jsx('span', {
                        children: progressType === 'cover' ? '封面进度' : '内容进度'
                      }),
                      jsx('span', {
                        children: [progressCount, '/', progressTotal]
                      })
                    ]
                  }),
                  jsx('div', {
                    className: floatingPanelStyles.progressBar,
                    children: jsx('div', {
                      className: floatingPanelStyles.progressFill,
                      style: {
                        width: progressPercent + '%'
                      }
                    })
                  })
                ]
              }),
              jsx('div', {
                className: floatingPanelStyles.btnGroup,
                children: [
                  jsx('select', {
                    className: floatingPanelStyles.select,
                    value: concurrency,
                    disabled: snap.jobRunning,
                    onChange: (e3) => setConcurrency(Number(e3.target.value)),
                    children: [1, 2, 3, 4, 5].map((n2) =>
                      jsx(
                        'option',
                        {
                          value: n2,
                          children: ['并发 ', n2]
                        },
                        n2
                      )
                    )
                  }),
                  jsx('button', {
                    className: floatingPanelStyles.btn,
                    onClick: () => downloadManager.markSelectAll(!downloadManager.isSelectAll()),
                    children: downloadManager.isSelectAll() ? '取消全选' : '全选'
                  }),
                  jsx('button', {
                    className: floatingPanelStyles.btn,
                    onClick: () => onOpenSettings?.(),
                    children: '设置'
                  }),
                  jsx('button', {
                    className: floatingPanelStyles.btn,
                    onClick: () => setShowJob(true),
                    children: '查看详情'
                  }),
                  !snap.jobRunning
                    ? jsx(Fragment, {
                        children: [
                          jsx('button', {
                            className: floatingPanelStyles.btnPrimary,
                            onClick: () => startJob('content'),
                            disabled: snap.counts.selected === 0,
                            children: '开始下载'
                          }),
                          jsx('button', {
                            className: floatingPanelStyles.btn,
                            onClick: () => startJob('content', 'eagle'),
                            disabled: snap.counts.selected === 0,
                            children: '存 Eagle'
                          }),
                          jsx('button', {
                            className: floatingPanelStyles.btn,
                            onClick: () => startJob('cover'),
                            disabled: snap.counts.selected === 0,
                            children: '下载封面'
                          })
                        ]
                      })
                    : jsx('button', {
                        className: floatingPanelStyles.btnDanger,
                        onClick: () => downloadManager.pauseJob(),
                        children: '暂停'
                      })
                ]
              })
            ]
          }),
        jsx('button', {
          className: floatingPanelStyles.fab,
          style: fabStyle,
          title: '按住可拖动位置',
          onPointerDown: drag.onPointerDown,
          onClick: () => {
            if (drag.draggedRef.current) return;
            const next = !exp;
            setExp(next);
            writePanelOpen(next);
          },
          children: exp ? '❌' : '插件'
        }),
        showJob &&
          jsx(ProfileJobModalApp, {
            downloadManager,
            onClose: () => setShowJob(false)
          })
      ]
    });
  };
  var EagleQuickButtonApp = ({mediaHandler}) => {
    const [, setTick] = useState(0);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
      const timer = setInterval(() => setTick((v3) => v3 + 1), 1500);
      return () => clearInterval(timer);
    }, []);
    if (!/(^|\/)(video|note)\//.test(location.pathname)) return null;
    const media = mediaHandler.current_media;
    const eagleTarget = (Config.global.features.downloader_config || {}).eagle || {};
    const targetTags = Array.isArray(eagleTarget.tags) ? eagleTarget.tags : [];
    const targetTip =
      '目标：' +
      (eagleTarget.folder_name || '库根目录') +
      ' · ' +
      (targetTags.length > 0 ? targetTags.length + ' 个标签' : '无标签') +
      (eagleTarget.author_as_folder === true ? ' · 作者文件夹' : '') +
      (eagleTarget.author_as_tag === true ? ' · 作者标签' : '');
    const handlePush = async () => {
      if (busy) return;
      setBusy(true);
      try {
        await mediaHandler.push_current_to_eagle();
      } finally {
        setTimeout(() => setBusy(false), 1200);
      }
    };
    return jsx('div', {
      className: floatingPanelEagleStyles.quickWrap,
      children: [
        jsx('button', {
          className: floatingPanelEagleStyles.quickFab,
          onClick: handlePush,
          disabled: busy,
          title: targetTip,
          children: busy ? '⏳ 推送中...' : media ? '存到 Eagle' : '存到 Eagle（先播放）'
        })
      ]
    });
  };
  // ─── src/ui/FloatingPanel.ts · 浮动面板宿主 ────────────────────────
  class FloatingPanel {
    constructor() {
      this.root = null;
      this.mounted = false;
    }
    // 挂载浮动面板到 DOM
    mount({dataService, downloadManager, onOpenSettings}) {
      this.root = document.createElement('div');
      this.root.id = 'dy-dl-floating-panel';
      document.body.appendChild(this.root);
      this.mounted = true;
      try {
        render(
          jsx(FloatingPanelApp, {
            dataService,
            downloadManager,
            onOpenSettings
          }),
          this.root
        );
      } catch (err) {
        console.error('[dy-dl] FloatingPanelUI 加载失败', err);
      }
    }
    // 卸载浮动面板
    unmount() {
      if (this.root && this.mounted) {
        render(null, this.root);
        this.root.remove();
        this.root = null;
        this.mounted = false;
      }
    }
  }
  // ─── src/core/download/ProfileDownloadState.ts · IndexedDB 存储层 ───
  var DB_NAME = 'dy-dl-profile-download-state';
  var DB_VERSION = 3;
  var STORE_NAME = 'profile-download-state';
  var MAX_STORED_PROFILE_STATES = 30;
  var PROFILE_STATE_TTL_MS = 90 * 24 * 60 * 60 * 1e3;
  var dbPromise = null;
  var PUSH_STORE_NAME = 'push-records';
  var PUSH_INDEX_NAME = 'by-pushedAt';
  // 推送记录默认上限；设置里可改（见 PUSH_CAP_OPTIONS），0 = 不限
  var PUSH_CAP_DEFAULT = 50000;
  var PUSH_CAP_OPTIONS = [5000, 20000, 50000, 0];
  // 记录里保存的作品名截断长度（完整名字在 Eagle 素材里，记录只为徽标提示）
  var PUSH_NAME_MAX = 60;
  var PUSH_RECORD_TTL_MS = 365 * 24 * 60 * 60 * 1e3;
  // 0 = 不过期
  // 打开超时：旧版脚本的连接没处理 versionchange，会把 v3 升级堵死；
  // 一旦被堵，indexedDB.open 永远不 settle，面板选择态与推送记录都会一直等下去。
  // 所以这里必须自己兜底超时，失败后快速失败一段时间，避免每次调用都排队新的 open。
  var DB_OPEN_TIMEOUT_MS = 4e3;
  var DB_RETRY_AFTER_MS = 3e4;
  var dbBlockedAt = 0;
  var dbBlockedReason = '';
  function dbIsBlocked() {
    return dbBlockedAt > 0 && Date.now() - dbBlockedAt < DB_RETRY_AFTER_MS;
  }
  function markDBBlocked(reason) {
    dbBlockedAt = Date.now();
    dbBlockedReason = reason || '未知原因';
    try {
      console.warn(
        '[dy-dl] IndexedDB 暂不可用：' +
          dbBlockedReason +
          '（推送记录与主页选择态降级为内存模式，' +
          DB_RETRY_AFTER_MS / 1e3 +
          ' 秒后自动重试）'
      );
    } catch {}
  }
  function getProfileStateDB() {
    if (!dbPromise) {
      if (dbIsBlocked()) return Promise.reject(new Error('IndexedDB 暂不可用：' + dbBlockedReason));
      dbPromise = new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          fn(value);
        };
        const fail = (reason) => {
          dbPromise = null;
          markDBBlocked(reason);
          finish(reject, new Error(reason));
        };
        try {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          timer = setTimeout(() => fail('打开超时'), DB_OPEN_TIMEOUT_MS);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME, {
                keyPath: 'profileKey'
              });
            }
            let pushStore = null;
            if (!db.objectStoreNames.contains(PUSH_STORE_NAME)) {
              pushStore = db.createObjectStore(PUSH_STORE_NAME, {
                keyPath: 'key'
              });
            } else if (request.transaction) {
              // v2 → v3：老库已经有 store，只需要补 pushedAt 索引（清理时按时间游标淘汰）
              pushStore = request.transaction.objectStore(PUSH_STORE_NAME);
            }
            if (pushStore) {
              try {
                if (!pushStore.indexNames || !pushStore.indexNames.contains(PUSH_INDEX_NAME)) {
                  pushStore.createIndex(PUSH_INDEX_NAME, 'pushedAt');
                }
              } catch (err) {
                console.warn('[dy-dl] 推送记录索引创建失败（清理会退回全量扫描）', err);
              }
            }
          };
          request.onsuccess = () => {
            const db = request.result;
            // 别的标签页要升级版本时主动让路，否则会互相堵死（旧版脚本正是缺这段）
            try {
              db.onversionchange = () => {
                try {
                  db.close();
                } catch {}
              };
            } catch {}
            finish(resolve, db);
          };
          request.onerror = () => {
            const err = request.error;
            fail('打开失败：' + ((err && (err.name || err.message)) || '未知错误'));
          };
          request.onblocked = () => fail('被其他抖音标签页占用');
        } catch (error) {
          dbPromise = null;
          markDBBlocked('打开异常：' + ((error && (error.message || error.name)) || error));
          finish(reject, error);
        }
      });
    }
    return dbPromise;
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  /* ====================================================================
   * 推送记录（PushHistory）—— 记录「作品是否已推送到 Eagle」
   * 复用同一个 IndexedDB（见 ProfileDownloadState），v2 起新增 push-records。
   * key = `platform:awemeId`，预留 platform 便于以后扩到微博 / 小红书。
   * 记录层失败一律降级：不影响推送主流程。
   * ================================================================== */
  /** 统一读取推送记录相关配置（存在 downloader_config.eagle 域下） */
  function readPushCfg() {
    try {
      const f = (Config && Config.global && Config.global.features) || {};
      const e = (f.downloader_config && f.downloader_config.eagle) || {};
      const rawCap = Number(e.push_record_cap);
      return {
        history: e.push_history !== false,
        badge: e.push_badge !== false,
        forever: e.push_record_forever === true,
        // 记录条数上限：0 = 不限；没配置时用默认 50000
        cap: Number.isFinite(rawCap) && rawCap >= 0 ? rawCap : PUSH_CAP_DEFAULT
      };
    } catch (err) {
      return {
        history: true,
        badge: true,
        forever: false,
        cap: PUSH_CAP_DEFAULT
      };
    }
  }
  var pushIndex = null;
  var pushWriteCount = 0;

  /** 作品页地址（只在导出时补齐；存储里不再保存，省空间） */
  function pushPageUrlOf(awemeId) {
    return awemeId ? 'https://www.douyin.com/video/' + awemeId : '';
  }

  /** 内存索引项：只保留徽标与 tooltip 需要的字段，比整条记录小 3-4 倍 */
  function toPushIndexEntry(row) {
    if (!row || !row.awemeId) return null;
    return {
      awemeId: String(row.awemeId),
      pushedAt: row.pushedAt || 0,
      pushCount: row.pushCount || 0,
      name: row.name || '',
      folderName: row.folderName || ''
    };
  }

  /** 落盘记录：去掉 pageUrl / apiStyle / itemIds，作品名截断，约 150 字节/条 */
  function toStoredPushRecord(rec) {
    return {
      key: rec.key,
      platform: rec.platform || 'douyin',
      awemeId: String(rec.awemeId),
      pushedAt: rec.pushedAt || 0,
      pushCount: rec.pushCount || 0,
      lastBatchId: rec.lastBatchId || '',
      folderId: rec.folderId || '',
      folderName: rec.folderName || '',
      name: String(rec.name || '').slice(0, PUSH_NAME_MAX),
      mediaType: rec.mediaType || '',
      mediaCount: rec.mediaCount || 1,
      tags: Array.isArray(rec.tags) ? rec.tags.slice(0, 20) : [],
      updatedAt: rec.updatedAt || Date.now()
    };
  }

  /** 遍历推送记录：有游标就流式读（大库也不会一次性铺满内存），没有就退回 getAll */
  function iteratePushRows(store, onRow) {
    return new Promise((resolve, reject) => {
      let req = null;
      try {
        req = typeof store.openCursor === 'function' ? store.openCursor() : null;
      } catch (err) {
        req = null;
      }
      if (!req) {
        let allReq = null;
        try {
          allReq = store.getAll();
        } catch (err) {
          resolve();
          return;
        }
        allReq.onsuccess = () => {
          try {
            const rows = allReq.result || [];
            for (let i = 0; i < rows.length; i += 1) onRow(rows[i], null);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        allReq.onerror = () => reject(allReq.error);
        return;
      }
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        try {
          onRow(cursor.value, cursor);
        } catch (err) {
          reject(err);
          return;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ─── src/handlers/douyin/push-history.ts · Eagle 推送记录 ──────────
  class PushHistory {
    static _key(awemeId, platform) {
      return `${platform || 'douyin'}:${awemeId}`;
    }
    /** 打开 DB 并把记录投影成轻量索引（卡片渲染需要同步判断是否已推送） */
    static init() {
      // 加载进行中（页面启动就会调一次）时复用同一个 promise，避免第二个调用拿到空索引
      if (PushHistory._initPromise) return PushHistory._initPromise;
      if (pushIndex) return Promise.resolve(pushIndex);
      pushIndex = new Map();
      PushHistory._initPromise = (async () => {
        try {
          const db = await getProfileStateDB();
          const store = db.transaction(PUSH_STORE_NAME, 'readonly').objectStore(PUSH_STORE_NAME);
          await iteratePushRows(store, (row) => {
            const entry = toPushIndexEntry(row);
            if (entry) pushIndex.set(entry.awemeId, entry);
          });
          console.debug('[dy-dl] 推送记录已加载：', pushIndex.size);
        } catch (err) {
          // 加载失败就把索引清掉，下次调用会重试；期间只是不显示「已推送」标记
          pushIndex = null;
          console.warn('[dy-dl] 推送记录加载失败（降级：不显示「已推送」标记）', err);
          return null;
        } finally {
          PushHistory._initPromise = null;
        }
        return pushIndex;
      })();
      return PushHistory._initPromise;
    }
    static get(awemeId) {
      if (!pushIndex || !awemeId) return null;
      return pushIndex.get(String(awemeId)) || null;
    }
    static has(awemeId) {
      return !!PushHistory.get(awemeId);
    }
    static count() {
      return pushIndex ? pushIndex.size : 0;
    }
    /** 读库里的一条完整记录（合并 pushCount / 文件夹信息用；索引里没有这些） */
    static async _readStored(awemeId) {
      try {
        const db = await getProfileStateDB();
        const store = db.transaction(PUSH_STORE_NAME, 'readonly').objectStore(PUSH_STORE_NAME);
        if (typeof store.get !== 'function') return null;
        const row = await requestResult(store.get(PushHistory._key(awemeId)));
        return row || null;
      } catch (err) {
        return null;
      }
    }
    /** 读库里全部完整记录（导出 / 导入合并用） */
    static async _readAll() {
      const rows = [];
      try {
        const db = await getProfileStateDB();
        const store = db.transaction(PUSH_STORE_NAME, 'readonly').objectStore(PUSH_STORE_NAME);
        await iteratePushRows(store, (row) => {
          if (row && row.awemeId) rows.push(row);
        });
      } catch (err) {
        console.warn('[dy-dl] 读取全部推送记录失败', err);
      }
      return rows;
    }
    /** 从一条 Eagle 素材反推抖音作品 id（素材的 url 字段存的就是作品页地址） */
    static _awemeIdFromItem(item) {
      if (!item) return '';
      const hay = [item.website, item.url, item.annotation, item.name].filter(Boolean).join(' ');
      const m = hay.match(/video\/(\d{15,})/) || hay.match(/(\d{18,})/);
      return m ? m[1] : '';
    }

    /**
     * 从 Eagle 素材库重建记录（Eagle 库在本机，等于权威的本地记录）。
     * 逐页拉取素材，按素材里的作品页 URL 反推 awemeId；已有记录的不动。
     */
    static async rebuildFromEagle() {
      const eagleCfg = (Config.global.features.downloader_config || {}).eagle || {};
      const baseURL = String(eagleCfg.base_url || 'http://127.0.0.1:41595').replace(/\/+$/, '');
      const client = getEagleClient({
        baseURL
      });
      if (!client || typeof client.request !== 'function') {
        throw new Error('Eagle 客户端接口不可用（缺少 request 方法）');
      }
      const LIMIT = 200;
      let style = 'v1';
      try {
        style = await client.getApiStyle();
      } catch (err) {}
      // 素材列表没有对应的 EAGLE_API_MAP 条目，需要自己拼路径：
      // v1 = /api/item/list（itemLookupByUrl 的 v1 路径佐证）；v2 推测 /api/v2/item/get。
      const candidates =
        style === 'v2' ? ['/api/v2/item/get', '/api/item/list'] : ['/api/item/list', '/api/v2/item/get'];
      let offset = 0;
      let added = 0;
      let scanned = 0;
      for (;;) {
        let resp = null;
        let lastErr = null;
        for (const p of candidates) {
          try {
            resp = await client.request(p + '?limit=' + LIMIT + '&offset=' + offset, 'GET');
            candidates.length = 1; // 记住可用路径，后续不再试另一个
            candidates[0] = p;
            break;
          } catch (err) {
            lastErr = err;
            console.warn('[dy-dl] 素材列表路径不可用：' + p + ' → ' + (err && err.message ? err.message : err));
          }
        }
        if (!resp) throw lastErr || new Error('无法从 Eagle 读取素材列表');
        const items = EagleClient.extractListData(resp) || [];
        if (!items.length) break;
        for (const item of items) {
          scanned += 1;
          const awemeId = PushHistory._awemeIdFromItem(item);
          if (!awemeId) continue;
          if (PushHistory.get(awemeId)) continue;
          const pageUrl = String(item.url || item.website || '');
          await PushHistory.record(
            {
              awemeId,
              shareInfo: {
                shareUrl: pageUrl
              }
            },
            '',
            {
              config: {
                folder_name: ''
              },
              name: String(item.name || ''),
              website: pageUrl,
              folders: [],
              tags: Array.isArray(item.tags) ? item.tags : [],
              fromEagle: true,
              rebuild: true
            }
          );
          added += 1;
        }
        offset += items.length;
        if (items.length < LIMIT) break;
        if (offset >= 200000) break; // 安全上限（约 1000 页）
      }
      return {
        scanned,
        added,
        disk: await PushHistory.diskCount()
      };
    }

    /** 导出用的数据结构（完整记录 + 补齐 pageUrl） */
    static async exportData() {
      const rows = await PushHistory._readAll();
      return {
        format: 'douyin-push-records',
        version: 2,
        exportedAt: Date.now(),
        records: rows.map((row) => Object.assign({}, row, { pageUrl: pushPageUrlOf(row.awemeId) }))
      };
    }

    /** 合并导入：同一条记录取更大的 pushCount 与更晚的 pushedAt */
    static async importRecords(list) {
      const arr = Array.isArray(list) ? list : [];
      if (!arr.length) return 0;
      await PushHistory.init();
      const existing = new Map();
      for (const row of await PushHistory._readAll()) existing.set(String(row.awemeId), row);
      const db = await getProfileStateDB();
      const tx = db.transaction(PUSH_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PUSH_STORE_NAME);
      let n = 0;
      for (const raw of arr) {
        try {
          const awemeId = raw && raw.awemeId ? String(raw.awemeId) : '';
          if (!awemeId) continue;
          const prev = existing.get(awemeId) || null;
          const stored = toStoredPushRecord({
            key: PushHistory._key(awemeId),
            platform: 'douyin',
            awemeId,
            pushedAt: Math.max(prev ? prev.pushedAt || 0 : 0, raw.pushedAt || 0),
            pushCount: Math.max(prev ? prev.pushCount || 0 : 0, raw.pushCount || 0),
            lastBatchId: (prev && prev.lastBatchId) || '',
            folderId: raw.folderId || (prev && prev.folderId) || '',
            folderName: raw.folderName || (prev && prev.folderName) || '',
            tags: Array.isArray(raw.tags) ? raw.tags.slice() : (prev && prev.tags) || [],
            name: raw.name || (prev && prev.name) || '',
            mediaType: raw.mediaType || (prev && prev.mediaType) || '',
            mediaCount: raw.mediaCount || (prev && prev.mediaCount) || 1,
            updatedAt: Date.now()
          });
          store.put(stored);
          if (pushIndex) pushIndex.set(awemeId, toPushIndexEntry(stored));
          n += 1;
        } catch (err) {
          console.warn('[dy-dl] 导入单条记录失败', err);
        }
      }
      await transactionComplete(tx);
      await PushHistory.prune().catch(() => {});
      return n;
    }

    /** 直接从 IndexedDB 数条数（绕过内存索引）—— 用来确认记录是否真的落盘 */
    static async diskCount() {
      try {
        const db = await getProfileStateDB();
        const tx = db.transaction(PUSH_STORE_NAME, 'readonly');
        return await requestResult(tx.objectStore(PUSH_STORE_NAME).count());
      } catch (err) {
        console.warn('[dy-dl] 读取落盘记录数失败', err);
        return -1;
      }
    }
    /** 列表（默认按推送时间倒序）—— 返回内存索引里的轻量记录 */
    static list() {
      if (!pushIndex) return [];
      return Array.from(pushIndex.values()).sort((a, b) => (b.pushedAt || 0) - (a.pushedAt || 0));
    }
    static stats() {
      const all = PushHistory.list();
      return {
        count: all.length,
        newest: all.length ? all[0].pushedAt : null,
        oldest: all.length ? all[all.length - 1].pushedAt : null
      };
    }
    /**
     * 写入 / 更新一条记录。
     * @param fromEagle true 表示这次是「Eagle 里已存在被跳过」，不计入 pushCount
     */
    static async record(media, mediaType, ctx = {}) {
      try {
        if (!readPushCfg().history && !ctx.rebuild) return null;
        const awemeId = media && media.awemeId ? String(media.awemeId) : '';
        if (!awemeId) {
          console.warn('[dy-dl] 推送记录跳过：media.awemeId 缺失');
          return null;
        }
        await PushHistory.init();
        if (!pushIndex) return null;
        const prev = await PushHistory._readStored(awemeId);
        const now = Date.now();
        const imageCount = Array.isArray(media && media.images) ? media.images.length : 0;
        const stored = toStoredPushRecord({
          key: PushHistory._key(awemeId),
          platform: 'douyin',
          awemeId,
          pushedAt: now,
          pushCount:
            (prev && prev.pushCount ? prev.pushCount : 0) +
            (ctx.fromEagle || (ctx.batchId && prev && prev.lastBatchId === ctx.batchId) ? 0 : 1),
          lastBatchId: ctx.batchId || (prev && prev.lastBatchId) || '',
          folderId: ctx.folders && ctx.folders[0] ? String(ctx.folders[0]) : (prev && prev.folderId) || '',
          folderName: (ctx.config && ctx.config.folder_name) || (prev && prev.folderName) || '',
          tags: Array.isArray(ctx.tags) ? ctx.tags.slice() : (prev && prev.tags) || [],
          name: ctx.name || (prev && prev.name) || '',
          mediaType: mediaType || (prev && prev.mediaType) || '',
          mediaCount: imageCount || (prev && prev.mediaCount) || 1,
          updatedAt: now
        });
        pushIndex.set(awemeId, toPushIndexEntry(stored));
        const db = await getProfileStateDB();
        const tx = db.transaction(PUSH_STORE_NAME, 'readwrite');
        tx.objectStore(PUSH_STORE_NAME).put(stored);
        await transactionComplete(tx);
        pushWriteCount += 1;
        if (pushWriteCount >= 50) {
          pushWriteCount = 0;
          PushHistory.prune().catch(() => {});
        }
        return stored;
      } catch (err) {
        console.warn('[dy-dl] 推送记录写入失败（不影响推送本身）', err);
        return null;
      }
    }
    static async remove(awemeId) {
      try {
        await PushHistory.init();
        const id = String(awemeId);
        if (pushIndex) pushIndex.delete(id);
        const db = await getProfileStateDB();
        const tx = db.transaction(PUSH_STORE_NAME, 'readwrite');
        tx.objectStore(PUSH_STORE_NAME).delete(PushHistory._key(id));
        await transactionComplete(tx);
        return true;
      } catch (err) {
        console.warn('[dy-dl] 删除推送记录失败', err);
        return false;
      }
    }
    static async clear() {
      try {
        await PushHistory.init();
        const db = await getProfileStateDB();
        const tx = db.transaction(PUSH_STORE_NAME, 'readwrite');
        tx.objectStore(PUSH_STORE_NAME).clear();
        await transactionComplete(tx);
        if (pushIndex) pushIndex.clear();
        return true;
      } catch (err) {
        console.warn('[dy-dl] 清空推送记录失败', err);
        return false;
      }
    }
    /**
     * 按「条数上限 + TTL」淘汰最老的记录。
     * 有 pushedAt 索引时用游标只读/删需要的那一段（O(删除数)），
     * 没有索引（老浏览器 / 测试桩）先只读扫一遍算出要删的，再用独立事务删。
     */
    static async prune() {
      try {
        await PushHistory.init();
        if (!pushIndex) return 0;
        const cfg = readPushCfg();
        const cap = Number.isFinite(Number(cfg.cap)) && Number(cfg.cap) >= 0 ? Number(cfg.cap) : PUSH_CAP_DEFAULT;
        const cutoff = !cfg.forever && PUSH_RECORD_TTL_MS > 0 ? Date.now() - PUSH_RECORD_TTL_MS : 0;
        if (!cap && !cutoff) return 0;
        let total = await PushHistory.diskCount();
        if (!(total >= 0)) total = pushIndex.size;
        const overBy = cap > 0 && total > cap ? total - cap : 0;
        if (!overBy && !cutoff) return 0;
        const db = await getProfileStateDB();

        // 1) 探测 pushedAt 索引是否可用（可用就走游标，不全量读）
        let canCursor = false;
        try {
          const probe = db.transaction(PUSH_STORE_NAME, 'readonly').objectStore(PUSH_STORE_NAME);
          const idx = typeof probe.index === 'function' ? probe.index(PUSH_INDEX_NAME) : null;
          canCursor = !!(idx && typeof idx.openCursor === 'function');
        } catch (err) {
          canCursor = false;
        }

        const removed = [];
        if (!canCursor) {
          // 2) 兜底：只读扫一遍 → 按时间升序算要删的 → 一个事务删掉
          const rows = [];
          const readStore = db.transaction(PUSH_STORE_NAME, 'readonly').objectStore(PUSH_STORE_NAME);
          await iteratePushRows(readStore, (row) => {
            if (row && row.awemeId) rows.push(row);
          });
          rows.sort((a, b) => (a.pushedAt || 0) - (b.pushedAt || 0));
          const dropKeys = [];
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const tooOld = cutoff > 0 && (row.pushedAt || 0) < cutoff;
            if (i < overBy || tooOld) {
              removed.push(String(row.awemeId));
              dropKeys.push(row.key || PushHistory._key(row.awemeId));
            }
          }
          if (dropKeys.length) {
            const wtx = db.transaction(PUSH_STORE_NAME, 'readwrite');
            const wstore = wtx.objectStore(PUSH_STORE_NAME);
            for (const k of dropKeys) wstore.delete(k);
            await transactionComplete(wtx);
          }
          for (const id of removed) pushIndex.delete(id);
          if (removed.length) console.debug('[dy-dl] 推送记录已清理（全量扫描）：', removed.length);
          return removed.length;
        }

        // 3) 索引游标：按 pushedAt 升序，最老的在最前，删够就停
        const tx = db.transaction(PUSH_STORE_NAME, 'readwrite');
        // 先挂 oncomplete，游标跑完时事务可能已经提交，晚挂会永远等不到
        const txDone = transactionComplete(tx).catch(() => {});
        const store = tx.objectStore(PUSH_STORE_NAME);
        const source = store.index(PUSH_INDEX_NAME);
        await new Promise((resolve) => {
          let req = null;
          try {
            req = source.openCursor();
          } catch (err) {
            req = null;
          }
          if (!req) {
            resolve();
            return;
          }
          let pos = 0;
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
              resolve();
              return;
            }
            const row = cursor.value || {};
            const pushedAt = typeof row.pushedAt === 'number' ? row.pushedAt : 0;
            const overCap = pos < overBy;
            const tooOld = cutoff > 0 && pushedAt < cutoff;
            const at = pos;
            pos += 1;
            if (overCap || tooOld) {
              removed.push(String(row.awemeId || ''));
              try {
                cursor.delete();
              } catch (err) {
                try {
                  store.delete(cursor.primaryKey);
                } catch (err2) {}
              }
            }
            // 越过超限部分、且已进入 TTL 有效期 → 后面的都更新，可以停
            const enough = cutoff > 0 ? at >= overBy && pushedAt >= cutoff : at + 1 >= overBy;
            if (enough) {
              resolve();
              return;
            }
            cursor.continue();
          };
          req.onerror = () => resolve();
        });
        await txDone;
        for (const id of removed) pushIndex.delete(id);
        if (!removed.length) return 0;
        console.debug('[dy-dl] 推送记录已清理：', removed.length);
        return removed.length;
      } catch (err) {
        console.warn('[dy-dl] 推送记录清理失败', err);
        return 0;
      }
    }
  }

  var dyPushApi = {
    version: '2',
    list: () => PushHistory.list(),
    get: (id) => PushHistory.get(id),
    has: (id) => PushHistory.has(id),
    count: () => PushHistory.count(),
    cfg: () => readPushCfg(),
    diskCount: () => PushHistory.diskCount(),
    rebuildFromEagle: () => PushHistory.rebuildFromEagle(),
    exportData: () => PushHistory.exportData(),
    importRecords: (list) => PushHistory.importRecords(list),
    stats: () => PushHistory.stats(),
    remove: (id) => PushHistory.remove(id),
    clear: () => PushHistory.clear(),
    prune: () => PushHistory.prune(),
    init: () => PushHistory.init().then((m) => (m ? m.size : 0)),
    /** IndexedDB 是否处于降级状态（被别的标签页占用 / 打开超时） */
    dbStatus: () => ({
      blocked: dbIsBlocked(),
      reason: dbBlockedReason || '',
      since: dbBlockedAt || 0
    })
  };
  // 注意：脚本声明了 @grant，Tampermonkey 会把它放进沙箱运行 —— 此时脚本里的 window
  // 是「沙箱的 window」，页面控制台看不到挂在它上面的属性。所以额外挂到：
  //   1) unsafeWindow（页面 window，沙箱可能不允许写，失败就忽略）
  //   2) document.documentElement（真实 DOM 对象，不受沙箱限制，最可靠）
  try {
    window.__dyPush = dyPushApi;
  } catch (err) {
    console.warn('[dy-dl] __dyPush 挂到 window 失败', err);
  }
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) unsafeWindow.__dyPush = dyPushApi;
  } catch (err) {
    console.debug('[dy-dl] __dyPush 挂到 unsafeWindow 被沙箱阻止（可忽略，用 documentElement 那条）');
  }
  try {
    document.documentElement.__dyPush = dyPushApi;
  } catch (err) {
    console.warn('[dy-dl] __dyPush 挂到 documentElement 失败', err);
  }
  PushHistory.init()
    .then((m) => {
      console.log(
        '[dy-dl] 推送记录已就绪：',
        m ? m.size : 0,
        '条（控制台查询：document.documentElement.__dyPush.list()）'
      );
    })
    .catch(() => {});
  class ProfileDownloadState {
    static _storage_key(profileKey) {
      return `${this.STORAGE_PREFIX}${profileKey}`;
    }
    static create_default(profile = {}) {
      return {
        version: 1,
        profileKey: profile.profileKey || '',
        secUid: profile.secUid || '',
        profileName: profile.profileName || '',
        tabKey: profile.tabKey || 'post',
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunAt: 0,
        completedAt: 0,
        knownIds: [],
        downloadedIds: [],
        failedItems: {},
        coverDownloadedIds: [],
        coverFailedItems: {}
      };
    }
    static async load(profileKey, profile = {}) {
      try {
        const db = await getProfileStateDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const stored = await requestResult(transaction.objectStore(STORE_NAME).get(profileKey));
        if (stored) {
          this._remove_legacy(profileKey);
          return this._normalize(stored, profile, profileKey);
        }
        const legacy = this._read_legacy(profileKey);
        if (legacy) {
          const state = this._normalize(legacy, profile, profileKey);
          await this.save(profileKey, state);
          return state;
        }
        return this.create_default({
          ...profile,
          profileKey
        });
      } catch (error) {
        console.error('[dy-dl]加载作者下载状态失败', error);
        const legacy = this._read_legacy(profileKey);
        if (legacy) return this._normalize(legacy, profile, profileKey);
        return this.create_default({
          ...profile,
          profileKey
        });
      }
    }
    static async save(profileKey, state) {
      const nextState = {
        ...state,
        updatedAt: Date.now()
      };
      try {
        const db = await getProfileStateDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(nextState);
        await transactionComplete(transaction);
        this._remove_legacy(profileKey);
      } catch (error) {
        console.error('[dy-dl]保存作者下载状态到 IndexedDB 失败', error);
      }
      return nextState;
    }
    static async reset(profileKey) {
      try {
        const db = await getProfileStateDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(profileKey);
        await transactionComplete(transaction);
      } catch (error) {
        console.error('[dy-dl]删除作者下载状态失败', error);
      }
      this._remove_legacy(profileKey);
    }
    static async pruneOldStates() {
      try {
        const db = await getProfileStateDB();
        const readTransaction = db.transaction(STORE_NAME, 'readonly');
        const records = await requestResult(readTransaction.objectStore(STORE_NAME).getAll());
        const cutoff = Date.now() - PROFILE_STATE_TTL_MS;
        const toDelete = new Set();
        for (const state of records) {
          if (!state.updatedAt || state.updatedAt < cutoff) toDelete.add(state.profileKey);
        }
        const active = records
          .filter((state) => state.updatedAt && state.updatedAt >= cutoff)
          .sort((a3, b) => (b.updatedAt || 0) - (a3.updatedAt || 0));
        for (const state of active.slice(MAX_STORED_PROFILE_STATES)) toDelete.add(state.profileKey);
        if (toDelete.size === 0) return;
        const writeTransaction = db.transaction(STORE_NAME, 'readwrite');
        const store = writeTransaction.objectStore(STORE_NAME);
        for (const profileKey of toDelete) store.delete(profileKey);
        await transactionComplete(writeTransaction);
        console.info(`[dy-dl]清理作者下载状态 ${toDelete.size} 条`);
      } catch (error) {
        console.error('[dy-dl]清理作者下载状态失败', error);
      }
    }
    static async migrateLegacyStorage() {
      try {
        const legacyKeys = [];
        for (let i3 = 0; i3 < localStorage.length; i3++) {
          const key = localStorage.key(i3);
          if (key && key.startsWith(this.STORAGE_PREFIX)) legacyKeys.push(key);
        }
        if (legacyKeys.length === 0) return;
        const db = await getProfileStateDB();
        const readTransaction = db.transaction(STORE_NAME, 'readonly');
        const storedRecords = await requestResult(readTransaction.objectStore(STORE_NAME).getAll());
        const storedByKey = new Map(storedRecords.map((state) => [state.profileKey, state]));
        const statesToPut = [];
        for (const key of legacyKeys) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }
          const profileKey = key.slice(this.STORAGE_PREFIX.length);
          const state = this._normalize(parsed, {}, profileKey);
          if (!parsed?.updatedAt) state.updatedAt = 0;
          const stored = storedByKey.get(profileKey);
          if (!stored || (stored.updatedAt || 0) < (state.updatedAt || 0)) statesToPut.push(state);
        }
        if (statesToPut.length > 0) {
          const writeTransaction = db.transaction(STORE_NAME, 'readwrite');
          const store = writeTransaction.objectStore(STORE_NAME);
          for (const state of statesToPut) store.put(state);
          await transactionComplete(writeTransaction);
        }
        for (const key of legacyKeys) localStorage.removeItem(key);
      } catch (error) {
        console.error('[dy-dl]迁移旧作者下载状态失败', error);
      }
    }
    static _normalize(parsed, profile, profileKey) {
      const source = parsed && typeof parsed === 'object' ? parsed : {};
      return {
        ...this.create_default({
          ...profile,
          profileKey
        }),
        ...source,
        profileKey,
        secUid: profile.secUid || source.secUid || '',
        profileName: profile.profileName || source.profileName || '',
        tabKey: profile.tabKey || source.tabKey || 'post',
        knownIds: Array.isArray(source.knownIds) ? source.knownIds : [],
        downloadedIds: Array.isArray(source.downloadedIds) ? source.downloadedIds : [],
        failedItems: source.failedItems && typeof source.failedItems === 'object' ? source.failedItems : {},
        coverDownloadedIds: Array.isArray(source.coverDownloadedIds) ? source.coverDownloadedIds : [],
        coverFailedItems:
          source.coverFailedItems && typeof source.coverFailedItems === 'object' ? source.coverFailedItems : {}
      };
    }
    static _read_legacy(profileKey) {
      try {
        const raw = localStorage.getItem(this._storage_key(profileKey));
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (error) {
        console.error('[dy-dl]读取旧作者下载状态失败', error);
        return null;
      }
    }
    static _remove_legacy(profileKey) {
      try {
        localStorage.removeItem(this._storage_key(profileKey));
      } catch {}
    }
  }
  ProfileDownloadState.STORAGE_PREFIX = '__douyin-dl-profile-state__:';
  function throttle(func, limit) {
    let inThrottle = false;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }
  // ─── src/core/download/ProfileDownloadManager.ts · 批量下载调度 ────
  class ProfileDownloadManager extends Emitter {
    constructor({mediaHandler: mediaHandler2, dataService}) {
      super();
      this.jobState = null;
      this.jobRunning = false;
      this.jobStopRequested = false;
      this.jobEndRequested = false;
      this.jobLog = [];
      this.currentDownloadType = 'content';
      /** 本次任务并发数，不写入全局配置 */
      this._concurrency = 1;
      /** 本次任务的方块状态，不持久化 */
      this._itemStatus = {};
      /** 选中的媒体 */
      this.selectedIds = new Set();
      /** 本次推送 / 下载的汇总统计（用于结束时的结果提示） */
      this._runStats = {
        saved: 0,
        skipped: 0,
        failed: 0
      };
      /** 本次推送最近一次失败原因 */
      this._lastRunError = '';
      this.collect_timer = null;
      this._loadPromise = null;
      this._loadProfileKey = '';
      this._saveQueue = Promise.resolve();
      this._storageInit = ProfileDownloadState.migrateLegacyStorage()
        .then(() => ProfileDownloadState.pruneOldStates())
        // 数据库被占用时不能让这个 promise 挂住/抛错：否则面板永远拿不到 jobState
        .catch((err) => {
          console.warn('[dy-dl] 下载状态存储不可用（本次会话降级为内存状态）', err);
        });
      this.mediaHandler = mediaHandler2;
      this.dataService = dataService;
      const collect = throttle(this.collect.bind(this), 1e3);
      this.collect_timer = setInterval(collect, 5 * 1e3);
      window.addEventListener('wheel', collect, {
        passive: false
      });
    }
    async collect() {
      if (!this.dataService.isProfilePage()) return;
      await this._ensureJobState();
      if (!this.jobState) return;
      const prev = this.jobState.knownIds.length || 0;
      const mediaList = this.dataService.collectCurrentFeedMedia();
      this.mergeMediaIntoState(mediaList);
      const changed = this.jobState.knownIds.length - prev;
      if (changed) {
        this.emit('stateChanged', this);
        this.emit('countsUpdated', this.getCounts());
      }
    }
    // 确保 jobState 与当前页面 profile 匹配
    async _ensureJobState(profile) {
      const context = profile || this.dataService.getProfileContext();
      if (!context) {
        if (!this.jobRunning) {
          this.jobState = null;
          this._clearSessionState();
        }
        return null;
      }
      const needLoad = !this.jobState || (!this.jobRunning && this.jobState.profileKey !== context.profileKey);
      if (!needLoad) return this.jobState;
      if (this._loadProfileKey === context.profileKey && this._loadPromise) {
        return this._loadPromise;
      }
      this._clearSessionState();
      this.jobState = null;
      const loadProfileKey = context.profileKey;
      this._loadProfileKey = loadProfileKey;
      const load = this._storageInit
        .then(() => ProfileDownloadState.load(loadProfileKey, context))
        .then((state) => {
          if (this._loadProfileKey === loadProfileKey) this.jobState = state;
          return state;
        })
        .catch((error) => {
          console.error('[dy-dl]加载作者下载状态失败', error);
          if (this._loadProfileKey === loadProfileKey) this.jobState = ProfileDownloadState.create_default(context);
          return this.jobState;
        })
        .finally(() => {
          if (this._loadProfileKey === loadProfileKey) {
            this._loadPromise = null;
            this._loadProfileKey = '';
          }
          this.emit('stateChanged', this);
        });
      this._loadPromise = load;
      return load;
    }
    /** 页面跳转后同步当前会话状态 */
    async syncPageState() {
      await this._ensureJobState();
      this.emit('stateChanged', this);
    }
    _clearSessionState() {
      this.jobLog = [];
      this.selectedIds.clear();
      this._itemStatus = {};
      this.currentDownloadType = 'content';
      this._concurrency = 1;
    }
    _saveJobState() {
      if (!this.jobState?.profileKey) return Promise.resolve(this.jobState);
      const profileKey = this.jobState.profileKey;
      const run = this._saveQueue.then(async () => {
        await this._storageInit;
        const state = this.jobState;
        if (!state?.profileKey || state.profileKey !== profileKey) return state;
        try {
          return await ProfileDownloadState.save(profileKey, state);
        } catch (err) {
          // 存储不可用时只影响「下次打开还记得选择」，不影响本次会话
          return state;
        }
      });
      this._saveQueue = run.then(
        () => void 0,
        () => void 0
      );
      return run;
    }
    _push_log(status, message, media, type = this.currentDownloadType) {
      this.jobLog.push({
        time: Date.now(),
        type,
        awemeId: media?.awemeId || '',
        desc: media?.desc || '',
        status,
        message
      });
      if (this.jobLog.length > 200) this.jobLog.splice(0, this.jobLog.length - 200);
      this.emit('jobLog', this.jobLog.slice());
    }
    /**
     * 批量推送结束时的结果提示（对齐小红书版）：
     * 「N 成功 / N 跳过 / N 失败」汇总，失败时带上最近一次失败原因；
     * 用底部居中的大号提示，作者主页卡片铺满时也能看清。
     */
    _notifyRunSummary() {
      const stats = this._runStats || {
        saved: 0,
        skipped: 0,
        failed: 0
      };
      const parts = [];
      if (stats.saved > 0) parts.push(stats.saved + ' 成功');
      if (stats.skipped > 0) parts.push(stats.skipped + ' 跳过');
      if (stats.failed > 0) parts.push(stats.failed + ' 失败');
      const toast = createEaglePushToast();
      if (parts.length === 0) {
        toast.update('没有待推送项', EAGLE_PUSH_TOAST_MS);
      } else if (stats.failed > 0 && stats.saved === 0 && stats.skipped === 0) {
        toast.update('❌ 推送失败：' + (this._lastRunError || '未知原因'), EAGLE_PUSH_TOAST_MS);
      } else if (stats.failed > 0) {
        toast.update(
          '⚠️ 已推送到 Eagle：' + parts.join('，') + '；失败原因：' + (this._lastRunError || '未知'),
          EAGLE_PUSH_TOAST_MS
        );
      } else if (stats.saved === 0 && stats.skipped > 0) {
        toast.update('⏭️ 作品均已在 Eagle 中，跳过 ' + stats.skipped + ' 个', EAGLE_PUSH_TOAST_MS);
      } else {
        toast.update('✅ 已推送到 Eagle：' + parts.join('，'), EAGLE_PUSH_TOAST_MS);
      }
    }
    mergeMediaIntoState(mediaList) {
      if (!this.jobState) return;
      const knownIds = new Set(this.jobState.knownIds || []);
      mediaList.forEach((media) => {
        if (media?.awemeId) knownIds.add(media.awemeId);
      });
      this.jobState.knownIds = Array.from(knownIds);
    }
    markDownloaded(media, downloadType = 'content') {
      if (!this.jobState || !media?.awemeId) return;
      if (downloadType === 'cover') {
        const downloadedIds = new Set(this.jobState.coverDownloadedIds || []);
        downloadedIds.add(media.awemeId);
        this.jobState.coverDownloadedIds = Array.from(downloadedIds);
        if (this.jobState.coverFailedItems?.[media.awemeId]) delete this.jobState.coverFailedItems[media.awemeId];
      } else {
        const downloadedIds = new Set(this.jobState.downloadedIds || []);
        downloadedIds.add(media.awemeId);
        this.jobState.downloadedIds = Array.from(downloadedIds);
        if (this.jobState.failedItems?.[media.awemeId]) delete this.jobState.failedItems[media.awemeId];
      }
    }
    markFailed(media, reason = 'unknown', downloadType = 'content', message = reason) {
      if (!this.jobState || !media?.awemeId) return;
      if (downloadType === 'cover') {
        const prev = this.jobState.coverFailedItems?.[media.awemeId] || {};
        this.jobState.coverFailedItems = this.jobState.coverFailedItems || {};
        this.jobState.coverFailedItems[media.awemeId] = {
          count: Number(prev.count || 0) + 1,
          reason,
          message: message || reason,
          updatedAt: Date.now(),
          desc: media.desc || prev.desc || ''
        };
      } else {
        const prev = this.jobState.failedItems?.[media.awemeId] || {};
        this.jobState.failedItems = this.jobState.failedItems || {};
        this.jobState.failedItems[media.awemeId] = {
          count: Number(prev.count || 0) + 1,
          reason,
          message: message || reason,
          updatedAt: Date.now(),
          desc: media.desc || prev.desc || ''
        };
      }
    }
    markSelect(awemeId, selected) {
      const changed = selected ? !this.selectedIds.has(awemeId) : this.selectedIds.has(awemeId);
      if (selected) this.selectedIds.add(awemeId);
      else this.selectedIds.delete(awemeId);
      if (changed) {
        this.emit('stateChanged', this);
        this.emit('countsUpdated', this.getCounts());
      }
    }
    markSelectMany(ids, selected) {
      let changed = false;
      for (const awemeId of ids) {
        const has = this.selectedIds.has(awemeId);
        if (selected && !has) {
          this.selectedIds.add(awemeId);
          changed = true;
        } else if (!selected && has) {
          this.selectedIds.delete(awemeId);
          changed = true;
        }
      }
      if (changed) {
        this.emit('stateChanged', this);
        this.emit('countsUpdated', this.getCounts());
      }
    }
    markSelectAll(selected) {
      if (!selected) this.selectedIds.clear();
      else this.jobState?.knownIds?.forEach((id) => this.selectedIds.add(id));
      this.emit('stateChanged', this);
      this.emit('countsUpdated', this.getCounts());
    }
    isSelectAll() {
      return this.selectedIds.size === this.jobState?.knownIds?.length;
    }
    _isFeedSelected(awemeId) {
      return this.selectedIds.has(awemeId);
    }
    getFeedCardStatus(awemeId) {
      const running = this._itemStatus[awemeId] === 'running';
      return {
        selected: this.selectedIds.has(awemeId),
        contentDownloaded: this.jobState?.downloadedIds?.includes(awemeId) || false,
        coverDownloaded: this.jobState?.coverDownloadedIds?.includes(awemeId) || false,
        failed: Boolean(this.jobState?.failedItems?.[awemeId]),
        coverFailed: Boolean(this.jobState?.coverFailedItems?.[awemeId]),
        running,
        runningType: running ? this.currentDownloadType : null
      };
    }
    getCounts() {
      return {
        known: this.jobState?.knownIds?.length || 0,
        downloaded: this.jobState?.downloadedIds?.length || 0,
        failed: Object.keys(this.jobState?.failedItems || {}).length,
        coverDownloaded: this.jobState?.coverDownloadedIds?.length || 0,
        coverFailed: Object.keys(this.jobState?.coverFailedItems || {}).length,
        selected: this.selectedIds.size,
        is_selected_all: this.isSelectAll()
      };
    }
    _normalizeConcurrency(value) {
      const raw = Number(value);
      const next = Number.isFinite(raw) ? Math.floor(raw) : 1;
      return Math.min(Math.max(next, 1), 5);
    }
    _deriveItemStatuses() {
      const statuses = {};
      if (!this.jobState) return statuses;
      const isCover = this.currentDownloadType === 'cover';
      const downloadedSet = new Set(
        isCover ? this.jobState.coverDownloadedIds || [] : this.jobState.downloadedIds || []
      );
      const failedItems = isCover ? this.jobState.coverFailedItems || {} : this.jobState.failedItems || {};
      const failedSet = new Set(Object.keys(failedItems));
      this.selectedIds.forEach((id) => {
        if (failedSet.has(id)) statuses[id] = 'failed';
        else if (downloadedSet.has(id)) statuses[id] = 'success';
        else statuses[id] = 'pending';
      });
      return statuses;
    }
    getSnapshot(profileNameFallback = '当前作者主页') {
      if (!this.jobState) void this._ensureJobState();
      const isProfilePage = this.dataService.isProfilePage();
      const profile = !this.jobRunning && isProfilePage ? this.dataService.getProfileContext() : null;
      const profileName = this.jobState?.profileName || profile?.profileName || profileNameFallback;
      const statusLabel = this.jobRunning
        ? this.jobStopRequested
          ? this.jobEndRequested
            ? '结束中...'
            : '暂停中...'
          : '进行中'
        : this.jobState?.status === 'completed'
          ? '已完成'
          : this.jobState?.status === 'paused'
            ? '已暂停'
            : this.jobState?.status === 'idle'
              ? '已结束'
              : '待开始';
      const counts = this.getCounts();
      const itemStatuses = Object.keys(this._itemStatus).length > 0 ? this._itemStatus : this._deriveItemStatuses();
      return {
        jobRunning: this.jobRunning,
        jobStopRequested: this.jobStopRequested,
        jobStatus: this.jobState?.status || 'idle',
        profileName,
        statusLabel,
        counts,
        jobLog: this.jobLog.slice(),
        downloadType: this.currentDownloadType,
        concurrency: this._concurrency,
        itemStatuses: {
          ...itemStatuses
        }
      };
    }
    // 重置状态
    async resetState() {
      const profile = this.dataService.getProfileContext();
      if (!profile) return false;
      if (this.jobRunning) await this.endJob();
      await this._storageInit;
      await this._saveQueue;
      this.jobLog = [];
      await ProfileDownloadState.reset(profile.profileKey);
      this.currentDownloadType = 'content';
      this._concurrency = 1;
      this._itemStatus = {};
      this.jobState = ProfileDownloadState.create_default(profile);
      this._loadPromise = null;
      this._loadProfileKey = '';
      await this.collect();
      this.emit('stateChanged', this);
      return true;
    }
    // 暂停当前下载，循环会在当前项结束后停止
    async pauseJob() {
      if (!this.jobRunning || this.jobStopRequested) return;
      this.jobStopRequested = true;
      if (this.jobState?.profileKey) {
        this.jobState.status = 'paused';
        await this._saveJobState();
      }
      this._push_log('info', '已暂停');
      this.emit('jobPaused');
      this.emit('stateChanged', this);
    }
    // 继续上次暂停的下载
    resumeJob() {
      if (this.jobRunning) return;
      if (this.jobState?.status !== 'paused') return;
      return this.startJob(this.currentDownloadType, this._concurrency);
    }
    // 结束当前下载阶段，回到选择阶段
    async endJob() {
      if (this.jobRunning) this.jobStopRequested = true;
      this.jobEndRequested = true;
      if (this.jobState?.profileKey) {
        this.jobState.status = 'idle';
        await this._saveJobState();
      }
      this._push_log('info', '已结束');
      this.emit('jobEnded');
      this.emit('stateChanged', this);
    }
    // 启动下载循环（由外部调用，这里只做前置准备）
    // downloaderOverride：本次任务临时指定下载器（目前用于「存 Eagle」按钮），不影响全局设置
    async startJob(downloadType = this.currentDownloadType, concurrency = 1, downloaderOverride = '') {
      if (!this.dataService.isProfilePage()) throw new Error('请在作者主页中使用全量下载。');
      await this._ensureJobState();
      if (this.jobRunning) return;
      if (this.mediaHandler.downloading) throw new Error('当前已有下载任务在进行中。');
      const releaseLock = this.mediaHandler._flag_start_download();
      const resuming = this.jobState?.status === 'paused' && downloadType === this.currentDownloadType;
      if (!resuming) this.jobLog = [];
      this.currentDownloadType = downloadType;
      this._downloaderOverride = downloaderOverride || '';
      this._concurrency = this._normalizeConcurrency(concurrency);
      this.jobRunning = true;
      this.jobStopRequested = false;
      this.jobEndRequested = false;
      // 本次运行的结果统计（推送结束时用 toast 汇报，不持久化）
      this._runStats = {
        saved: 0,
        skipped: 0,
        failed: 0
      };
      this._lastRunError = '';
      this.emit('jobStarted');
      const isEagleJob = this._downloaderOverride === 'eagle';
      this._push_log(
        'info',
        resuming ? (isEagleJob ? '继续推送到 Eagle' : '继续下载') : isEagleJob ? '开始推送到 Eagle' : '开始下载'
      );
      if (resuming) this.emit('jobResumed');
      this.emit('stateChanged', this);
      try {
        await this._runDownloadLoop();
      } finally {
        this.jobRunning = false;
        this.jobStopRequested = false;
        this.jobEndRequested = false;
        this._downloaderOverride = '';
        releaseLock();
        this.emit('stateChanged', this);
      }
    }
    async _runDownloadLoop() {
      const profile = this.dataService.getProfileContext();
      if (!profile) throw new Error('无法获取作者信息。');
      await this._ensureJobState(profile);
      if (!this.jobState) return;
      this.jobState.status = 'running';
      this.jobState.lastRunAt = Date.now();
      this.jobState.completedAt = 0;
      await this._saveJobState();
      this.emit('stateChanged', this);
      const downloadType = this.currentDownloadType;
      const downloadedIds =
        downloadType === 'cover' ? this.jobState.coverDownloadedIds || [] : this.jobState.downloadedIds || [];
      const failedItems =
        downloadType === 'cover' ? this.jobState.coverFailedItems || {} : this.jobState.failedItems || {};
      const downloadedSet = new Set(downloadedIds);
      const failedSet = new Set(Object.keys(failedItems));
      const selectedIdsArray = Array.from(this.selectedIds);
      const pendingIds = selectedIdsArray.filter((id) => !downloadedSet.has(id) || failedSet.has(id));
      this._itemStatus = this._deriveItemStatuses();
      this.emit('stateChanged', this);
      if (pendingIds.length === 0) {
        this.jobState.status = this.jobEndRequested ? 'idle' : 'completed';
        if (this.jobState.status === 'completed') this.jobState.completedAt = Date.now();
        await this._saveJobState();
        if (this.jobState.status === 'completed') {
          this._push_log('info', '没有待下载项，任务完成');
          if (this._downloaderOverride === 'eagle') this._notifyRunSummary();
          this.emit('jobCompleted');
        }
        this.emit('stateChanged', this);
        return;
      }
      const concurrency = this._concurrency;
      this._push_log('info', `并发数：${concurrency}`);
      await this._runConcurrentWorkers(pendingIds, downloadType, concurrency, this._downloaderOverride);
      if (!this.jobState) return;
      if (this.jobStopRequested) {
        this.jobState.status = this.jobEndRequested ? 'idle' : 'paused';
        await this._saveJobState();
        this.emit('stateChanged', this);
        return;
      }
      this.jobState.status = this.jobEndRequested ? 'idle' : 'completed';
      if (this.jobState.status === 'completed') this.jobState.completedAt = Date.now();
      await this._saveJobState();
      if (this.jobState.status === 'completed') {
        this._push_log('info', this._downloaderOverride === 'eagle' ? '推送完成' : '下载完成');
        if (this._downloaderOverride === 'eagle') this._notifyRunSummary();
        this.emit('jobCompleted');
      }
      this.emit('stateChanged', this);
    }
    async _downloadOne(awemeId, downloadType, downloaderOverride = '') {
      if (this.jobStopRequested) return;
      const media = this.dataService.feedMediaCache.get(awemeId);
      const isEaglePush = downloaderOverride === 'eagle';
      const actionWord = isEaglePush ? '推送' : '下载';
      if (!media) {
        const fakeMedia = {
          awemeId,
          desc: '未缓存'
        };
        console.warn('[dy-dl] 缓存中未找到作品', awemeId);
        this._itemStatus[awemeId] = 'failed';
        if (isEaglePush) {
          this._runStats.failed += 1;
          this._lastRunError = this._lastRunError || '缓存中未找到作品';
        }
        this._push_log('failed', '缓存中未找到作品，已标记失败', fakeMedia);
        this.markFailed(fakeMedia, 'cache_miss', downloadType, '缓存中未找到作品');
        await this._saveJobState();
        this.emit('stateChanged', this);
        this.emit('countsUpdated', this.getCounts());
        return;
      }
      this._itemStatus[awemeId] = 'running';
      this.emit('stateChanged', this);
      this._push_log('running', isEaglePush ? '开始推送' : '开始下载', media);
      const result =
        downloadType === 'cover'
          ? await this.mediaHandler._download_cover_logic(media, {
              alertOnFail: false,
              downloaderOverride
            })
          : await this.mediaHandler._download_media_logic(media, {
              toastTarget: null,
              toast: {
                update: () => {}
              },
              toastPrefix: '批量下载',
              alertOnFail: false,
              addHistory: true,
              downloaderOverride
            });
      const reason = result?.reason || (downloadType === 'cover' ? 'cover_download_failed' : 'download_failed');
      const errorMessage = result?.message || result?.error_msg || reason;
      if (isEaglePush) {
        // 推送到 Eagle 时按素材计数：saved / skipped / failed 由 _download_media_logic 汇总
        const savedCount = Number(result?.saved) || 0;
        const skippedCount = Number(result?.skipped) || 0;
        const failedCount = Number(result?.failed) || 0;
        this._runStats.saved += savedCount;
        this._runStats.skipped += skippedCount;
        this._runStats.failed += failedCount;
        if (result?.ok && savedCount === 0 && skippedCount === 0) this._runStats.saved += 1;
        if (!result?.ok) {
          if (failedCount === 0) this._runStats.failed += 1;
          this._lastRunError = this._lastRunError || errorMessage;
        }
      }
      if (result?.ok) {
        this._itemStatus[awemeId] = 'success';
        this.markDownloaded(media, downloadType);
        this._push_log('success', actionWord + '成功', media);
      } else {
        this._itemStatus[awemeId] = 'failed';
        this.markFailed(media, reason, downloadType, errorMessage);
        this._push_log('failed', actionWord + '失败：' + errorMessage, media);
      }
      await this._saveJobState();
      this.emit('stateChanged', this);
      this.emit('countsUpdated', this.getCounts());
      await new Promise((r3) => setTimeout(r3, 500));
    }
    async _runConcurrentWorkers(pendingIds, downloadType, concurrency, downloaderOverride = '') {
      let cursor = 0;
      const worker = async () => {
        while (!this.jobStopRequested) {
          const index = cursor++;
          if (index >= pendingIds.length) return;
          const awemeId = pendingIds[index];
          try {
            await this._downloadOne(awemeId, downloadType, downloaderOverride);
          } catch (error) {
            const media = this.dataService.feedMediaCache.get(awemeId);
            const fallbackMedia = {
              awemeId,
              desc: '下载异常'
            };
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[dy-dl] 批量下载任务异常', error);
            this._itemStatus[awemeId] = 'failed';
            if (downloaderOverride === 'eagle') {
              this._runStats.failed += 1;
              this._lastRunError = this._lastRunError || errorMessage;
            }
            this._push_log('failed', '下载异常：' + errorMessage, media || fallbackMedia);
            this.markFailed(media || fallbackMedia, 'unexpected_error', downloadType, errorMessage);
            await this._saveJobState();
            this.emit('stateChanged', this);
            this.emit('countsUpdated', this.getCounts());
          }
        }
      };
      const workerCount = Math.min(concurrency, pendingIds.length);
      await Promise.all(
        Array.from(
          {
            length: workerCount
          },
          () => worker()
        )
      );
    }
  }
  // ─── src/handlers/douyin/ProfilePageHandler.ts · 作者主页 ──────────
  class ProfilePageHandler {
    constructor({mediaHandler: mediaHandler2}) {
      this.panel = null;
      this.mediaHandler = mediaHandler2;
      this.dataService = new ProfileDataService();
      this.downloadManager = new ProfileDownloadManager({
        mediaHandler: mediaHandler2,
        dataService: this.dataService
      });
      this.watchPageChanges();
    }
    watchPageChanges() {
      let lastHref = location.href;
      setInterval(() => {
        if (location.href === lastHref) return;
        lastHref = location.href;
        this.downloadManager.syncPageState();
      }, 500);
    }
    mount_ui() {
      if (this.panel) return;
      this.panel = new FloatingPanel();
      this.panel.mount({
        dataService: this.dataService,
        downloadManager: this.downloadManager,
        onOpenSettings: () => this.mediaHandler.open_config_modal()
      });
      if (!this.eagleQuickRoot) {
        this.eagleQuickRoot = document.createElement('div');
        this.eagleQuickRoot.id = 'dy-dl-eagle-quick';
        document.body.appendChild(this.eagleQuickRoot);
        render(
          jsx(EagleQuickButtonApp, {
            mediaHandler: this.mediaHandler
          }),
          this.eagleQuickRoot
        );
      }
    }
  }
  // ─── src/index.ts · 启动 ───────────────────────────────────────────
  var downloader = new Downloader();
  var mediaHandler = new MediaHandler(downloader);
  var videoHandler = new VideoHandler();
  var danmakuHandler = new DanmakuHandler();
  var profilePageHandler = new ProfilePageHandler({
    mediaHandler
  });
  var domPatcher = new DOMPatcher({
    downloader,
    mediaHandler,
    videoHandler,
    danmakuHandler,
    profilePageHandler
  });
  var hotkeyManager = new HotkeyManager();
  var registerDownloadHotkey = () => {
    const features = Config.global.features;
    if (!features.enable_download_shortcut) return null;
    const shortcut = features.download_shortcut?.trim();
    if (!shortcut) return null;
    return hotkeyManager.addHotkey(shortcut, () => mediaHandler.download_current_media());
  };
  var registerEagleHotkey = () => {
    const features = Config.global.features;
    if (features.enable_eagle_shortcut === false) return null;
    const shortcut = features.eagle_shortcut?.trim();
    if (!shortcut) return null;
    return hotkeyManager.addHotkey(shortcut, () => mediaHandler.push_current_to_eagle());
  };
  var disposeDownloadHotkey = registerDownloadHotkey();
  var disposeEagleHotkey = registerEagleHotkey();
  Config.global.events.on('config_change', () => {
    disposeDownloadHotkey?.dispose();
    disposeDownloadHotkey = registerDownloadHotkey();
    disposeEagleHotkey?.dispose();
    disposeEagleHotkey = registerEagleHotkey();
  });
  mediaHandler.init();
  domPatcher.startObserving();
  profilePageHandler.mount_ui();
  console.log('[dy-dl]已启动');
})();
