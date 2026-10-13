'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('Anytime chores appear once in every routine, keep completion, and can be viewed alone',()=>{
 const D={people:[{id:'person',name:'Person'}],routines:[{id:'morning',name:'Morning',range:'Morning',from:0,to:11},{id:'after',name:'Midday',range:'Midday',from:11,to:17},{id:'evening',name:'Evening',range:'Evening',from:17,to:24},{id:'anytime',name:'Anytime',range:'All day',from:null,to:null}],chores:[{id:'all',r:'anytime',who:'person',title:'Anytime job',done:false},{id:'morning',r:'morning',who:'person',title:'Morning job',done:false}],stars:{},week:{}};
 const doc={addEventListener:()=>{},querySelector:()=>({})},window={DATA:D};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../dashboard/js/app.js'),'utf8'),{window,document:doc});
 const App=window.App;let hour=8,view,click;
 App.now=()=>new Date(2026,9,12,hour);App.register=(_,v)=>view=v;App.person=()=>({name:'Person'});App.avatar=()=>'';App.pstyle=()=>'';App.ring=()=>'';
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../dashboard/js/views/tasks.js'),'utf8'),{window,App,setTimeout:()=>{}});
 const el={innerHTML:'',addEventListener:(_,f)=>click=f};
 for(hour of [8,13,20]){
  assert.notEqual(App.currentRoutine().id,'anytime');view.show(el);
  assert.equal((el.innerHTML.match(/data-ch="all"/g)||[]).length,1);
  assert.match(el.innerHTML,/Anytime · all day/);
  assert.equal(el.innerHTML.includes('data-ch="morning"'),hour===8);
 }
 D.chores[0].done=true;view.show(el);assert.match(el.innerHTML,/ch is-done" data-ch="all"/);
 click({target:{closest:s=>s==='[data-r]'?{dataset:{r:'anytime'}}:null}});
 assert.match(el.innerHTML,/<h1 class="serif">Anytime/);assert(!el.innerHTML.includes('data-ch="morning"'));
});
