// Shopping: categorized list (left) + quick-add with usuals (right).
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, store: 'all', query: '', drawer: false, pending: {}, flash: null };

  function alphabetical(a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }); }
  function open() { return D.groceries.filter(function (g) { return !g.done && (V.store === 'all' || g.store === V.store); }).sort(function (a, b) { return alphabetical(a.name, b.name); }); }
  function done() { return D.groceries.filter(function (g) { return g.done && (V.store === 'all' || g.store === V.store); }).sort(function (a, b) { return alphabetical(a.name, b.name); }); }
  function storeName(id) { var s = D.stores.filter(function (s) { return s.id === id; })[0]; return s ? s.name : 'Store unavailable'; }

  function categorize(name) {
    var n = name.toLowerCase();
    var hit = D.catalog.filter(function (c) { return c[0].toLowerCase() === n; })[0] ||
      D.catalog.filter(function (c) { var a = c[0].toLowerCase(); return a.indexOf(n) > -1 || n.indexOf(a) > -1; })[0] ||
      D.catalog.filter(function (c) { return n.split(/\s+/).some(function (w) { return w.length > 3 && c[0].toLowerCase().indexOf(w) > -1; }); })[0];
    return hit && D.catOrder.all.indexOf(hit[1]) >= 0 ? hit[1] : D.catOrder.all.indexOf('Other') >= 0 ? 'Other' : D.catOrder.all[0];
  }
  function find(name, isDone) {
    return D.groceries.filter(function (g) { return !!g.done === isDone && g.name.toLowerCase() === name.toLowerCase(); })[0];
  }

  function row(g) {
    return '<div class="s-row' + (V.pending[g.id] ? ' is-checking' : '') + '" data-id="' + g.id + '">' +
      '<button class="s-hit" data-check="' + g.id + '">' +
      '<span class="s-box">' + App.icon('check', 22) + '</span>' +
      '<span class="s-name"><b>' + App.esc(g.name) + '</b>' + (g.note ? '<small>' + App.esc(g.note) + '</small>' : '') + '</span>' +
      (V.store === 'all' ? '<span class="s-store">' + App.esc(storeName(g.store)) + '</span>' : '') +
      '</button>' +
      '<div class="s-qty"><button data-qty="-1" data-id="' + g.id + '" aria-label="Less">' + App.icon('minus', 22) + '</button><span class="num">' + g.qty + '</span><button data-qty="1" data-id="' + g.id + '" aria-label="More">' + App.icon('plus', 22) + '</button></div>' +
      '</div>';
  }

  function listHTML() {
    if (V.store !== 'all' && !D.stores.some(function (s) { return s.id === V.store; })) V.store = 'all';
    var items = open(), order = Array.from(new Set((D.catOrder[V.store] || D.catOrder.all).concat(['Other'], items.map(function (g) { return g.cat; }))));
    var groups = order.map(function (cat) { return { cat: cat, items: items.filter(function (g) { return g.cat === cat; }) }; }).filter(function (x) { return x.items.length; });
    var d = done();
    return (items.length ? groups.map(function (gr) {
      return '<div class="s-cat" data-cat="' + App.esc(gr.cat) + '"><div class="s-cat-h"><span class="label">' + App.esc(gr.cat) + '</span><span class="label" data-cat-count>' + gr.items.length + '</span></div>' + gr.items.map(row).join('') + '</div>';
    }).join('') : '<div class="s-empty serif">All stocked up.<br><i>Nothing left to buy.</i></div>') +
      (d.length ? '<div class="s-drawer' + (V.drawer ? ' is-open' : '') + '">' +
        '<button class="s-drawer-h" data-drawer><span>' + App.icon('check', 22) + ' Got it <b class="num">(' + d.length + ')</b></span><span class="label">' + (V.drawer ? 'Hide' : 'Show') + '</span></button>' +
        (V.drawer ? '<div class="s-drawer-list">' + d.map(function (g) {
          return '<button class="s-got" data-revive="' + g.id + '">' + App.esc(g.name) + '<span class="label">Add back</span></button>';
        }).join('') + '<button class="btn btn--ghost s-clear" data-clear>Clear ' + d.length + ' checked items</button></div>' : '') +
        '</div>' : '');
  }

  function suggestHTML() {
    var q = V.query.trim().toLowerCase();
    if (q) {
      var catalog = D.catalog.slice().sort(function (a, b) { return alphabetical(a[0], b[0]); });
      var matches = catalog.filter(function (c) { return c[0].toLowerCase().indexOf(q) === 0; })
        .concat(catalog.filter(function (c) { var i = c[0].toLowerCase().indexOf(q); return i > 0; })).slice(0, 5);
      var exact = matches.some(function (m) { return m[0].toLowerCase() === q; });
      return '<div class="label">Suggestions</div><div class="s-ac">' + matches.map(function (m) {
        var on = find(m[0], false);
        return '<button class="s-ac-row" data-add="' + App.esc(m[0]) + '"><b>' + App.esc(m[0]) + '</b><span class="label">' + (on ? 'On list · ×' + on.qty : App.esc(categorize(m[0]))) + '</span>' + App.icon('plus', 26) + '</button>';
      }).join('') + (exact ? '' : '<button class="s-ac-row s-ac-row--new" data-add="' + App.esc(V.query.trim()) + '"><b>Add “' + App.esc(V.query.trim()) + '”</b><span class="label">' + App.esc(categorize(V.query)) + '</span>' + App.icon('plus', 26) + '</button>') + '</div>';
    }
    return '<div class="s-usuals-heading"><h2>Usuals <span>' + D.usuals.length + '</span></h2><span class="label">A–Z · tap to add</span></div><div class="s-usuals">' + D.usuals.slice().sort(alphabetical).map(usualTile).join('') + '</div>';
  }
  function usualTile(name) {
    var on = find(name, false);
    return '<button class="s-tile' + (on ? ' is-on' : '') + '" data-add="' + App.esc(name) + '">' +
      '<b>' + App.esc(name) + '</b><span>' + (on ? App.icon('check', 16) + 'On list' + (on.qty > 1 ? ' ×' + on.qty : '') : App.esc(categorize(name))) + '</span></button>';
  }

  // ---- granular updates (full list + usuals rebuild costs ~500ms on the wall tablet)
  function swap(old, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    old.parentNode.replaceChild(tmp.firstChild, old);
  }
  function refreshSuggestFor(g) {
    if (V.query.trim()) return paintSuggest();
    var t = V.el.querySelector('.s-usuals [data-add="' + App.esc(g.name) + '"]');
    if (t) swap(t, usualTile(g.name));
  }
  function catCount(cat) {
    var c = Array.from(V.el.querySelectorAll('.s-cat')).find(function (el) { return el.dataset.cat === cat; });
    if (!c) return;
    var n = c.querySelectorAll('.s-row').length;
    if (!n) c.parentNode.removeChild(c);
    else c.querySelector('[data-cat-count]').textContent = n;
  }
  function inView(g) { return !g.done && (V.store === 'all' || g.store === V.store); }
  function insertRow(g) {
    var cat = Array.from(V.el.querySelectorAll('.s-cat')).find(function (el) { return el.dataset.cat === g.cat; });
    if (!inView(g)) return paintHead();
    if (!cat) return paintList();
    var tmp = document.createElement('div');
    tmp.innerHTML = row(g);
    var before = Array.from(cat.querySelectorAll('.s-row')).find(function (el) {
      var existing = D.groceries.find(function (item) { return item.id === el.dataset.id; });
      return existing && alphabetical(g.name, existing.name) < 0;
    });
    cat.insertBefore(tmp.firstChild, before || null);
    catCount(g.cat);
    paintHead();
  }
  function removeRow(g) {
    var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]');
    var drawer = V.el.querySelector('.s-drawer');
    if (!r || !drawer || V.drawer || !open().length) return paintList();
    r.parentNode.removeChild(r);
    catCount(g.cat);
    drawer.querySelector('.num').textContent = '(' + done().length + ')';
    paintHead();
  }
  function flash(g) {
    var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]');
    if (!r) return;
    r.classList.add('is-flash');
    if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    setTimeout(function () { r.classList.remove('is-flash'); }, 1200);
  }

  function paintList() { var l = V.el.querySelector('.s-list'); var st = l.scrollTop; l.innerHTML = listHTML(); l.scrollTop = st; paintHead(); }
  function paintSuggest() { V.el.querySelector('.s-suggest').innerHTML = suggestHTML(); }
  function paintHead() {
    var all = D.groceries.filter(function (g) { return !g.done; });
    V.el.querySelector('.s-count').innerHTML = '<span class="num">' + open().length + '</span> to get';
    V.el.querySelector('.s-stores').innerHTML = [['all', 'All']].concat(D.stores.map(function (s) { return [s.id, s.name]; })).map(function (s) {
      var n = s[0] === 'all' ? all.length : all.filter(function (g) { return g.store === s[0]; }).length;
      return '<button class="' + (V.store === s[0] ? 'is-on' : '') + '" data-store="' + App.esc(s[0]) + '">' + App.esc(s[1]) + ' <span class="num">' + n + '</span></button>';
    }).join('');
  }
  function render() {
    var oldList = V.el.querySelector('.s-list'), oldUsuals = V.el.querySelector('.s-usuals');
    var listScroll = oldList ? oldList.scrollTop : 0, usualScroll = oldUsuals ? oldUsuals.scrollTop : 0;
    V.el.innerHTML = '<div class="shop">' +
      '<header class="s-head"><div><div class="label">Shared list</div><h1 class="serif">Groceries</h1></div><div class="s-count"></div></header>' +
      '<div class="s-toolbar"><div class="seg s-stores" aria-label="Shopping list store"></div>' +
      '<div class="s-input-wrap">' + App.icon('plus', 24) + '<input aria-label="Find or add an item" class="s-input" maxlength="80" placeholder="Find or add an item…" autocomplete="off" enterkeyhint="done"><button class="s-search-clear" data-clear-search aria-label="Clear item search"' + (!V.query ? ' hidden' : '') + '>' + App.icon('x', 22) + '</button></div></div>' +
      '<div class="s-shopping"><div class="s-list-heading"><h2>To buy</h2><span class="label">By category · A–Z</span></div><div class="s-list"></div></div>' +
      '<aside class="s-side"><div class="s-suggest"></div></aside></div>';
    var input = V.el.querySelector('.s-input');
    input.value = V.query;
    input.addEventListener('input', function () { V.query = input.value; V.el.querySelector('.s-search-clear').hidden = !V.query; paintSuggest(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value.trim()) { add(input.value); } });
    paintList(); paintSuggest();
    V.el.querySelector('.s-list').scrollTop = listScroll;
    var usuals = V.el.querySelector('.s-usuals'); if (usuals) usuals.scrollTop = usualScroll;
  }

  function newItem(name) {
    var input = V.el.querySelector('.s-input'); if (input) input.blur();
    function options(values, selected) { return values.map(function (item) { return '<option value="' + App.esc(item[0]) + '"' + (item[0] === selected ? ' selected' : '') + '>' + App.esc(item[1]) + '</option>'; }).join(''); }
    App.sheet('<div class="sheet-pad"><div class="label">Add to shopping list</div><h2 class="serif sheet-h">' + App.esc(name) + '</h2>' +
      '<label class="s-new-field">Category<select data-new-category>' + options(D.catOrder.all.map(function (c) { return [c, c]; }), categorize(name)) + '</select></label>' +
      '<label class="s-new-field">Store<select data-new-store>' + options(D.stores.map(function (s) { return [s.id, s.name]; }), V.store === 'all' ? D.stores[0].id : V.store) + '</select></label>' +
      '<p class="s-new-status" role="status"></p><button class="btn" data-confirm-item>Add item</button></div>', {
      cls: 's-new-sheet', onMount: function (el, close) {
        el.querySelector('[data-confirm-item]').addEventListener('click', function () {
          var category = el.querySelector('[data-new-category]').value, store = el.querySelector('[data-new-store]').value;
          if (D.catOrder.all.indexOf(category) < 0 || !D.stores.some(function (s) { return s.id === store; })) { el.querySelector('.s-new-status').textContent = 'Stores or categories changed. Close this and try again.'; return; }
          close(); add(name, { category: category, store: store });
        });
      }
    });
  }
  function add(name, selection) {
    name = name.trim();
    if (!name) return;
    var known = D.catalog.find(function (c) { return c[0].toLowerCase() === name.toLowerCase(); });
    if (!selection && !known && !find(name, false) && !find(name, true)) return newItem(name);
    var g = find(name, false), msg;
    if (g) {
      g.qty++;
      msg = 'Already on the list · now <b>×' + g.qty + '</b> ' + App.esc(g.name);
      var q = V.el.querySelector('.s-list [data-id="' + g.id + '"] .s-qty .num');
      if (q) q.textContent = g.qty;
    } else if ((g = find(name, true))) {
      g.done = false; g.qty = 1;
      msg = 'Added back <b>' + App.esc(g.name) + '</b>';
      paintList();
    } else {
      g = { id: App.live ? 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) : D._gid(), name: known ? known[0] : name.charAt(0).toUpperCase() + name.slice(1), cat: selection ? selection.category : categorize(name), qty: 1, store: selection ? selection.store : V.store === 'all' ? D.stores[0].id : V.store, done: false, note: '' };
      D.groceries.push(g);
      msg = 'Added <b>' + App.esc(g.name) + '</b> to ' + App.esc(g.cat);
      insertRow(g);
    }
    var hadQuery = !!V.query.trim();
    V.query = '';
    var input = V.el.querySelector('.s-input');
    if (input) input.value = '';
    V.el.querySelector('.s-search-clear').hidden = true;
    if (hadQuery) paintSuggest(); else refreshSuggestFor(g);
    flash(g);
    App.emit('data');
    App.toast(msg, { icon: 'cart', ms: 3000 });
  }

  function check(g) {
    V.pending[g.id] = true;
    var rowEl = V.el.querySelector('[data-id="' + g.id + '"]');
    rowEl.classList.add('is-checking');
    setTimeout(function () {
      if (!V.pending[g.id]) return;
      delete V.pending[g.id];
      g.done = true;
      removeRow(g);
      refreshSuggestFor(g);
      App.emit('data');
    }, 1200);
    App.toast('<b>' + App.esc(g.name) + '</b> checked off', {
      icon: 'check',
      undo: function () {
        var wasDone = g.done;
        delete V.pending[g.id];
        g.done = false;
        if (wasDone) paintList();
        else { var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]'); if (r) r.classList.remove('is-checking'); }
        refreshSuggestFor(g);
        App.emit('data');
      }
    });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-check]'))) {
      var g = D.groceries.filter(function (x) { return x.id === t.dataset.check; })[0];
      if (g && !V.pending[g.id]) check(g);
      else if (g) { delete V.pending[g.id]; t.parentNode.classList.remove('is-checking'); }
      return;
    }
    if ((t = e.target.closest('[data-qty]'))) {
      var q = D.groceries.filter(function (x) { return x.id === t.dataset.id; })[0];
      q.qty = Math.max(1, q.qty + +t.dataset.qty);
      t.parentNode.querySelector('.num').textContent = q.qty;
      refreshSuggestFor(q);
      return;
    }
    if ((t = e.target.closest('[data-add]'))) return add(t.dataset.add);
    if ((t = e.target.closest('[data-clear-search]'))) { V.query = ''; V.el.querySelector('.s-input').value = ''; t.hidden = true; return paintSuggest(); }
    if ((t = e.target.closest('[data-store]'))) { V.store = t.dataset.store; paintList(); return paintSuggest(); }
    if ((t = e.target.closest('[data-drawer]'))) { V.drawer = !V.drawer; return paintList(); }
    if ((t = e.target.closest('[data-revive]'))) {
      var r = D.groceries.filter(function (x) { return x.id === t.dataset.revive; })[0];
      r.done = false; paintList(); paintSuggest(); App.emit('data');
      return App.toast('Added back <b>' + App.esc(r.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
    if ((t = e.target.closest('[data-clear]'))) {
      var gone = done();
      D.groceries = D.groceries.filter(function (x) { return gone.indexOf(x) < 0; });
      V.drawer = false;
      paintList();
      App.toast('Cleared ' + gone.length + ' items', {
        icon: 'check', undo: function () { D.groceries = D.groceries.concat(gone); paintList(); }
      });
    }
  }

  App.register('shopping', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  });
})();
