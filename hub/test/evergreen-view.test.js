'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
async function view(report, now = new Date(2026, 9, 12, 17)) {
  let rendered = 0;
  class Clock extends Date { static now() { return +now; } }
  const App = { live: true, esc: s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
    now: () => now, dayStart: d => new Date(d.getFullYear(),d.getMonth(),d.getDate()),
    addDays: (d,n) => new Date(d.getFullYear(),d.getMonth(),d.getDate()+n),
    sameDay: (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(),
    rerender: () => { rendered++; } };
  const doc = { hidden:false, addEventListener:()=>{} };
  const data = { report, receivedAt:now.toISOString(), feedStale:false, reportStale:false };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../dashboard/js/views/evergreen.js'),'utf8'), {
    App, document:doc, Date:Clock, AbortController, setInterval:()=>{}, setTimeout:()=>{}, clearTimeout:()=>{},
    fetch:async()=>({ok:true,json:async()=>data})
  });
  App.evergreen.active=true; App.evergreen.refresh(true);
  await new Promise(r=>setImmediate(r)); assert.equal(rendered,1);
  return { App, data, html:()=>App.evergreen.render() };
}
function report(now=new Date(2026,9,12,17)) {
  return { source:'Test owner', updatedAt:now.toISOString(), objective:'Build the project. Keep evidence distinct.', next:'Review the candidate.',
    work:[{id:'C0',title:'Scope <zero>',owner:'Owner',detail:'Saved evidence',stages:{built:true,reviewed:false,integrated:null,live:false}}],
    recent:[], decisions:[], blockers:[] };
}
test('visual map separates reported/pending/unknown and escapes source text',async()=>{
  const f=await view(report()), html=f.html();
  assert.match(html,/Built: 1 reported, 0 pending, 0 unknown/);
  assert.match(html,/Reviewed: 0 reported, 1 pending, 0 unknown/);
  assert.match(html,/Integrated: 0 reported, 0 pending, 1 unknown/);
  assert.match(html,/Live: 0 reported, 1 pending, 0 unknown/);
  assert.match(html,/Scope &lt;zero&gt;/); assert(!html.includes('Scope <zero>'));
  assert.match(html,/data-eg-open="work-C0"/); assert(!html.includes('data-eg-open="work-C0" open'));
  assert.match(html,/not overall completion/);
});
test('Today and Yesterday use event timestamps rather than report or receipt time',async()=>{
  const now=new Date(2026,9,12,17), r=report(now);
  r.recent=[{id:'today',title:'Today review',stage:'reviewed',at:new Date(2026,9,12,9).toISOString()},
    {id:'yesterday',title:'Yesterday integration',stage:'integrated',at:new Date(2026,9,11,23,59).toISOString()},
    {id:'earlier',title:'Earlier build',stage:'built',at:new Date(2026,9,10,12).toISOString()}];
  const f=await view(r,now), html=f.html();
  assert.match(html,/<h4>Today<\/h4><span class="eg-day-count">1 reported/);
  assert.match(html,/<h4>Yesterday<\/h4><span class="eg-day-count">1 reported/);
  assert.match(html,/<h4>Earlier<\/h4><span class="eg-day-count">1 reported/);
  assert(html.indexOf('Today review')<html.indexOf('<h4>Yesterday'));
  assert(html.indexOf('Yesterday integration')>html.indexOf('<h4>Yesterday'));
  f.data.receivedAt=new Date(+now+60000).toISOString(); assert.equal(f.html(),html);
});
test('empty dated progress does not infer completion and stale reports remain visible',async()=>{
  const f=await view(report());
  assert.match(f.html(),/<h4>Yesterday<\/h4><span class="eg-day-count">0 reported/);
  assert.match(f.html(),/No completions reported/);
  f.data.feedStale=true; f.data.reportStale=true;
  assert.match(f.html(),/Sync has not checked in/); assert.match(f.html(),/report is over a day old/);
});
test('disclosures and each panel scroll position survive report refresh',async()=>{
  const f=await view(report());
  const old={querySelectorAll:s=>s.includes('[open]')?[{dataset:{egOpen:'work-C0'}}]:[{dataset:{egScroll:'work'},scrollTop:160},{dataset:{egScroll:'sidebar'},scrollTop:40}]};
  const saved=f.App.evergreen.capture(old);
  const work={dataset:{egOpen:'work-C0'},open:false}, other={dataset:{egOpen:'context'},open:true};
  const scroll={dataset:{egScroll:'work'},scrollTop:0};
  f.App.evergreen.restore({querySelectorAll:s=>s==='[data-eg-open]'?[work,other]:[scroll]},saved);
  assert.equal(work.open,true);assert.equal(other.open,false);assert.equal(scroll.scrollTop,160);
});
test('checklist view shows achieved milestones without completing their parent or inventing today dates',async()=>{
 const r=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/progress-sample-v2.json')));
 const f=await view(r,new Date('2026-10-13T00:42:00Z')),html=f.html();
 assert.match(html,/Checklist progress/);assert.match(html,/Reported subset/);assert.match(html,/4 achieved milestones/);
 assert.match(html,/Underway · checklist open/);assert.match(html,/1 underway · 1 pending · 1 unknown/);
 assert.match(html,/<h4>Today<\/h4><span class="eg-day-count">0 reported/);
 assert(!html.includes('Built: 4 reported'));assert.match(html,/No completions reported/);
 const second=JSON.parse(JSON.stringify(r.sections[0]));second.id='C13';second.title='Network checks';second.items[0].id='C13.1';r.sections.push(second);
 f.App.evergreen.selectSection('C13');assert.match(f.html(),/Network checks/);
});
