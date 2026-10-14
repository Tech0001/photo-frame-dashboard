// Optional local hub transport. Static/Cloudflare builds continue to use the demo.
(function () {
  'use strict';
  var D = window.DATA, baseline = null, fetching = false, writing = false, dirty = false, timer, lastTouch = 0;
  window.HUB = { live:false, ok:false, at:0 };
  function replace(target, items) { target.splice.apply(target,[0,target.length].concat(items || [])); }
  function snapshot() { return { chores:Object.fromEntries(D.chores.map(function(c){return [c.id,!!c.done];})), groceries:JSON.stringify(D.groceries), base:D.groceries.map(function(g){return g.id;}) }; }
  async function request(url,method,body) {
    var control = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = control ? setTimeout(function(){control.abort();},8000) : null;
    try { var response = await fetch(url,{method:method || 'GET',cache:'no-store',signal:control ? control.signal : undefined,headers:body ? {'Content-Type':'application/json'} : {},body:body ? JSON.stringify(body) : undefined}); if (!response.ok) throw Error('Hub request failed'); return await response.json(); }
    finally { if (timeout) clearTimeout(timeout); }
  }
  function apply(state) {
    if (!state || !Array.isArray(state.people) || !Array.isArray(state.events) || !Array.isArray(state.photos)) throw Error('Invalid hub data');
    replace(D.people,state.people); replace(D.ALL,state.people.map(function(p){return p.id;}));
    replace(D.events,state.events.map(function(e){return Object.assign({},e,{start:new Date(e.start),end:new Date(e.end),people:e.people && e.people.length ? e.people:D.ALL.slice()});}));
    replace(D.chores,state.chores); replace(D.groceries,state.groceries); replace(D.stores,state.stores);
    D.stars = state.stars || {}; D.week = state.week || {};
    var categories = state.categories || D.catOrder.all;
    D.catOrder = {all:categories}; state.stores.forEach(function(s){D.catOrder[s.id] = categories;});
    if (state.commonItems) { replace(D.catalog,state.commonItems.map(function(i){return [i.name,i.cat];})); replace(D.usuals,state.commonItems.filter(function(i){return i.usual;}).map(function(i){return i.name;})); }
    replace(D.photos,state.photos);
    D.weatherLive = !!state.weather; D.weatherConfigured = !!state.weatherConfigured;
    if (state.weather) D.weather = state.weather;
    window.TUNE = state.tune || {};
    if (window.App) {
      if (state.display) { App.idle.home = state.display.homeSec || 60; App.idle.ambient = state.display.ambientSec || 120; }
      App.emit('tune',window.TUNE); App.emit('hub-state',state);
    }
    baseline = snapshot(); window.HUB.ok = true; window.HUB.at = Date.now();
  }
  async function pull() {
    if (fetching || writing || dirty || Date.now() - lastTouch < 1500) return;
    fetching = true;
    try { var state = await request('/api/state'); if (dirty || writing) return; apply(state); App.emit('data'); App.rerender(); }
    catch { window.HUB.ok = false; }
    finally { fetching = false; }
  }
  async function flush() {
    if (!baseline || writing) return;
    var now = snapshot(), changes = D.chores.filter(function(c){return baseline.chores[c.id] !== undefined && baseline.chores[c.id] !== !!c.done;});
    if (!changes.length && now.groceries === baseline.groceries) { dirty = false; return; }
    dirty = true; writing = true;
    try {
      for (var c of changes) await request('/api/chores/toggle','POST',{id:c.id,done:!!c.done});
      if (now.groceries !== baseline.groceries) await request('/api/groceries','PUT',{items:JSON.parse(now.groceries),base:baseline.base});
      baseline = now; dirty = false;
    } catch { window.HUB.ok = false; }
    finally { writing = false; }
  }
  window.liveBoot = async function () {
    try {
      apply(await request('/api/state')); window.HUB.live = true;
      document.addEventListener('pointerdown',function(){lastTouch = Date.now();},true);
      App.on('data',function(){ if (baseline) dirty = snapshot().groceries !== baseline.groceries || D.chores.some(function(c){return baseline.chores[c.id] !== !!c.done;}); });
      setInterval(flush,1500);
      function poll(){timer = setTimeout(async function(){await pull();poll();},Math.max(5,window.TUNE.pollSec || 20)*1000);}
      poll(); return true;
    } catch { return false; }
  };
  App.tune = function(key,fallback){return window.TUNE && window.TUNE[key] !== undefined ? window.TUNE[key]:fallback;};
})();
