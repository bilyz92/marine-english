/*
 * Bộ chạy xem trước cho các tệp .dc.html tải từ bảng thiết kế Claude Design.
 * Mỗi màn đã có <script src="./support.js"> trong <head>, nên chỉ cần đặt tệp này cạnh các màn.
 * Hỗ trợ đúng phần định dạng các màn đang dùng: {{đường.dẫn}}, <sc-for>, <sc-if>, <helmet>,
 * sự kiện onClick / onChange, class Component extends DCLogic với state / setState, data-props mặc định.
 * Đây chỉ là công cụ xem thiết kế trên máy, không phải mã của sản phẩm.
 *
 * Mở qua serve.js (Mo-giao-dien.cmd) để bộ chạy đọc được mã gốc: khi đó <sc-for> nằm trong <table>
 * vẫn đúng. Mở thẳng tệp (file://) vẫn xem được, trừ bảng dùng <sc-for> có thể hiển thị sai.
 */
(function () {
  'use strict';

  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  document.head.appendChild(hide);

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var PROPS = { value: 1, checked: 1, selected: 1 };

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };

  var root = null, source = [], instance = null, pending = false;

  function literal(expr) {
    if (expr === 'true') return { ok: true, v: true };
    if (expr === 'false') return { ok: true, v: false };
    if (expr === 'null') return { ok: true, v: null };
    if (/^-?\d+(\.\d+)?$/.test(expr)) return { ok: true, v: Number(expr) };
    var q = expr.match(/^'(.*)'$|^"(.*)"$/);
    if (q) return { ok: true, v: q[1] !== undefined ? q[1] : q[2] };
    return { ok: false };
  }

  function resolve(expr, scopes) {
    expr = String(expr || '').replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, '').trim();
    var lit = literal(expr);
    if (lit.ok) return lit.v;
    var parts = expr.split('.');
    var value, found = false;
    for (var i = scopes.length - 1; i >= 0; i--) {
      var s = scopes[i];
      if (s && Object.prototype.hasOwnProperty.call(s, parts[0])) { value = s[parts[0]]; found = true; break; }
    }
    if (!found) return undefined;
    for (var j = 1; j < parts.length; j++) {
      if (value === null || value === undefined) return undefined;
      value = value[parts[j]];
    }
    return value;
  }

  function interpolate(text, scopes) {
    return text.replace(HOLE, function (_, expr) {
      var v = resolve(expr, scopes);
      return v === null || v === undefined ? '' : String(v);
    });
  }

  function eventName(node, attr) {
    var name = attr.slice(2).toLowerCase();
    if (name === 'change') {
      var type = (node.getAttribute('type') || '').toLowerCase();
      if (node.localName === 'textarea' || (node.localName === 'input' && type !== 'checkbox' && type !== 'radio')) return 'input';
    }
    return name;
  }

  function renderChildren(nodes, parent, scopes) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], parent, scopes);
  }

  function renderFor(attrs, children, parent, scopes) {
    var list = resolve(attrs.getAttribute('list'), scopes);
    var as = attrs.getAttribute('as') || 'item';
    if (!list || typeof list.length !== 'number') return;
    for (var k = 0; k < list.length; k++) {
      var scope = { $index: k };
      scope[as] = list[k];
      renderChildren(children, parent, scopes.concat([scope]));
    }
  }

  function renderIf(attrs, children, parent, scopes) {
    if (resolve(attrs.getAttribute('value'), scopes)) renderChildren(children, parent, scopes);
  }

  function renderNode(node, parent, scopes) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(interpolate(node.nodeValue, scopes))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'helmet') return;
    if (tag === 'template' && node.hasAttribute('data-sc')) {
      var kind = node.getAttribute('data-sc');
      if (kind === 'for') return renderFor(node, node.content.childNodes, parent, scopes);
      if (kind === 'if') return renderIf(node, node.content.childNodes, parent, scopes);
    }
    if (tag === 'sc-for') return renderFor(node, node.childNodes, parent, scopes);
    if (tag === 'sc-if') return renderIf(node, node.childNodes, parent, scopes);
    renderElement(node, parent, scopes);
  }

  function renderElement(node, parent, scopes) {
    var el = document.createElementNS(node.namespaceURI, node.localName);
    var deferred = [];
    for (var a = 0; a < node.attributes.length; a++) {
      var name = node.attributes[a].name, raw = node.attributes[a].value;
      if (name.indexOf('hint-') === 0) continue;
      var whole = raw.match(WHOLE);
      if (/^on[a-z]/i.test(name)) {
        if (whole) {
          var handler = resolve(whole[1], scopes);
          if (typeof handler === 'function') el.addEventListener(eventName(node, name), handler);
        }
        continue; // never run inline handler code
      }
      if (whole) {
        var v = resolve(whole[1], scopes);
        if (PROPS[name]) { deferred.push([name, v]); continue; }
        if (v === true) el.setAttribute(name, '');
        else if (v !== false && v !== null && v !== undefined) el.setAttribute(name, String(v));
        continue;
      }
      el.setAttribute(name, raw.indexOf('{{') >= 0 ? interpolate(raw, scopes) : raw);
    }
    renderChildren(node.localName === 'template' ? node.content.childNodes : node.childNodes, el, scopes);
    parent.appendChild(el);
    for (var d = 0; d < deferred.length; d++) {
      var key = deferred[d][0], val = deferred[d][1];
      if (key === 'value') el.value = val === null || val === undefined ? '' : String(val);
      else el[key] = Boolean(val);
    }
  }

  function pathOf(el) {
    var path = [];
    while (el && el !== root) {
      var p = el.parentNode;
      if (!p) return null;
      path.unshift(Array.prototype.indexOf.call(p.children, el));
      el = p;
    }
    return el === root ? path : null;
  }
  function byPath(path) {
    var el = root;
    for (var i = 0; i < path.length && el; i++) el = el.children[path[i]];
    return el;
  }

  function render() {
    pending = false;
    var active = document.activeElement, focus = null, sel = null;
    if (active && root.contains(active)) {
      focus = active.id ? { id: active.id } : { path: pathOf(active) };
      try { sel = [active.selectionStart, active.selectionEnd]; } catch (e) { sel = null; }
    }
    var vals = {};
    if (instance) {
      try { vals = instance.renderVals() || {}; } catch (err) { console.error('renderVals lỗi:', err); }
    }
    var frag = document.createDocumentFragment();
    renderChildren(source, frag, [vals]);
    root.replaceChildren(frag);
    if (focus) {
      var target = focus.id ? document.getElementById(focus.id) : (focus.path && byPath(focus.path));
      if (target && target.focus) {
        target.focus({ preventScroll: true });
        if (sel && sel[0] !== null && sel[0] !== undefined) { try { target.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
      }
    }
  }
  function schedule() {
    if (pending || !root) return;
    pending = true;
    (window.queueMicrotask || setTimeout)(render);
  }

  // Parse the raw <x-dc> markup with sc-for / sc-if renamed to <template>, so the HTML parser
  // keeps loops inside tables exactly where they were written.
  function parseRaw(text) {
    var open = text.indexOf('<x-dc>'), close = text.lastIndexOf('</x-dc>');
    if (open < 0 || close < 0) return null;
    var inner = text.slice(open + 6, close)
      .replace(/<sc-(for|if)\b/g, '<template data-sc="$1"')
      .replace(/<\/sc-(for|if)>/g, '</template>');
    var doc = new DOMParser().parseFromString('<!doctype html><html><body><div id="dc-src">' + inner + '</div></body></html>', 'text/html');
    return Array.prototype.slice.call(doc.getElementById('dc-src').childNodes);
  }

  function propsFrom(script) {
    var props = {};
    try {
      var decl = JSON.parse(script.getAttribute('data-props') || '{}');
      Object.keys(decl).forEach(function (k) { if (k.charAt(0) !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k].default; });
    } catch (e) { console.error('data-props không đọc được:', e); }
    // Thử tweak qua địa chỉ, ví dụ BuyerInfo.dc.html?emailRequired=true
    new URLSearchParams(location.search).forEach(function (v, k) {
      props[k] = v === 'true' ? true : v === 'false' ? false : (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
    });
    return props;
  }

  function mount(raw) {
    var xdc = document.querySelector('x-dc');
    if (!xdc) return;
    var helmet = xdc.querySelector('helmet');
    if (helmet) Array.prototype.slice.call(helmet.children).forEach(function (child) { document.head.appendChild(child); });
    source = (raw && parseRaw(raw)) || Array.prototype.slice.call(xdc.childNodes);
    var script = document.querySelector('script[type="text/x-dc"]');
    if (script) {
      try {
        var Component = new Function('DCLogic', script.textContent + '\n;return typeof Component === "undefined" ? null : Component;')(DCLogic);
        if (Component) instance = new Component(propsFrom(script));
      } catch (err) { console.error('Không dựng được Component:', err); }
    }
    root = document.createElement('div');
    root.setAttribute('data-dc-root', '');
    xdc.parentNode.insertBefore(root, xdc);
    xdc.remove();
    render();
    if (instance && typeof instance.componentDidMount === 'function') instance.componentDidMount();
    if (!raw && document.querySelector('[data-dc-root] table')) {
      console.warn('Mở qua Mo-giao-dien.cmd để bảng có dòng lặp hiển thị đúng.');
    }
  }

  function start() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      fetch(location.href, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; })
        .then(mount, function () { mount(null); });
    } else mount(null);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
