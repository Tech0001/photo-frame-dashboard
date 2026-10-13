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
test('section cards escape titles and never infer checklist percentages from stage flags',async()=>{
 const f=await view(report()),html=f.html();
 assert.match(html,/Scope &lt;zero&gt;/);assert(!html.includes('Scope <zero>'));
 assert.match(html,/Progress not reported/);assert.match(html,/data-eg-open="section-C0"/);
 assert(!html.includes('100<small>%'));
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
test('section cards group overview scopes and show partial subtask detail without a false percentage',async()=>{
 const r=report();r.work.push({id:'C0.1',title:'Constituent scope',stages:{built:true,reviewed:true,integrated:true,live:true}});
 r.sections=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/progress-recovery-v2.json'))).sections;
 const f=await view(r),html=f.html();
 assert.equal((html.match(/data-eg-open="section-C0"/g)||[]).length,1);
 assert.match(html,/data-eg-open="section-C12"/);assert.match(html,/reported subset/);
 assert.match(html,/4\/7 milestones achieved/);assert.match(html,/Underway/);
 assert(!html.includes('57<small>%'));
 assert.match(html,/<h4>Today<\/h4><span class="eg-day-count">0 reported/);
});
test('section percentages use completed checklist items, including unknowns in the denominator',async()=>{
 const r=report();r.work=[];const base=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/progress-recovery-v2.json'))).sections[0].items[0];
 r.sections=[{id:'C0',title:'Foundations',coverage:'complete',items:Array.from({length:12},(_,i)=>({...base,id:'C0.'+i,status:i<7?'completed':i===7?'blocked':'unknown',checklistChecked:i<7,milestones:[]}))}];
 const f=await view(r);assert.match(f.html(),/58<small>%/);assert.match(f.html(),/7\/12 done · 1 blocked/);
 r.sections[0].coverage='partial';r.sections[0].totalItems=20;
 assert.match(f.html(),/35<small>%/);assert.match(f.html(),/7\/20 done/);
});

test('checkbox count history calculates daily percentage-point changes without stage scoring',async()=>{
 const now=new Date(2026,9,12,17),r=report(now),item=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/progress-recovery-v2.json'))).sections[0].items[0];
 const progress={completed:65,total:100,basis:'C3-v1',history:[{completed:55,total:100,basis:'C3-v1',at:new Date(2026,9,10,23).toISOString()},{completed:60,total:100,basis:'C3-v1',at:new Date(2026,9,11,23).toISOString()}]};
 item.progress=progress;r.sections=[{id:'C3',title:'Payments',coverage:'partial',items:[item],progress}];
 const f=await view(r,now),html=f.html();assert.match(html,/65<small>%/);assert.match(html,/65%/);assert.match(html,/\+5 pp today/);assert.match(html,/\+5 pp yesterday/);assert.match(html,/Underway/);
 r.sections[0].progress={...progress,total:120};assert.match(f.html(),/— today/);
 r.sections[0].progress={...progress,basis:'new-scope'};assert.match(f.html(),/— today/);
});

test('leaf subtasks show only zero or one hundred percent from their checkbox',async()=>{
 const r=report();const base=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/progress-recovery-v2.json'))).sections[0].items[0];
 r.sections=[{id:'C0',title:'Foundations',coverage:'complete',items:[{...base,id:'C0.1',checklistChecked:true,status:'completed',milestones:[]},{...base,id:'C0.2',checklistChecked:false,status:'underway',milestones:[]}]}];
 const html=(await view(r)).html();assert.match(html,/50<small>%/);assert.match(html,/100%/);assert.match(html,/>0%/);
 assert.match(html,/Checked subtasks ÷ total/);
});

test('rounding never shows one hundred percent for an unchecked checklist',async()=>{
 const r=report(),base=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/progress-recovery-v2.json'))).sections[0].items[0];
 r.sections=[{id:'C12',title:'Acceptance',coverage:'partial',items:[{...base,progress:{completed:249,total:250,basis:'checkboxes',history:[]}}],progress:{completed:249,total:250,basis:'section-checklist',history:[]}}];
 const html=(await view(r)).html();assert.match(html,/99<small>%/);assert.match(html,/99%/);assert(!html.includes('100%'));
});
