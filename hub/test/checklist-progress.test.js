'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {cleanReport,ProgressStore}=require('../lib/progress');
const fixture=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/progress-sample-v2.json')));
const now=Date.parse('2026-10-13T00:42:00Z');
test('version 2 keeps achieved milestones distinct from an open parent and strips private evidence locators',()=>{
 const r=fixture(),item=r.sections[0].items[0];r.localEvidence={path:'/PRIVATE_EVIDENCE'};item.evidenceRefs=['PRIVATE'];item.milestones[0].path='/PRIVATE_EVIDENCE';
 const out=cleanReport(r,now);assert.equal(out.schemaVersion,2);assert(!JSON.stringify(out).includes('PRIVATE'));
 assert.equal(out.sections[0].coverage,'partial');assert.equal(out.sections[0].items[0].checklistChecked,false);
 assert.deepEqual(out.sections[0].items[0].milestones.reduce((c,m)=>(c[m.status]=(c[m.status]||0)+1,c),{}),{completed:3,underway:2,pending:1,unknown:1});
 assert(out.sections[0].items[0].milestones.every(m=>m.at===null));assert.equal(out.sections[0].items[0].milestones[0].stages.live,false);
});
test('proposal, false closure, duplicate items, fake dates and malformed statuses cannot replace live progress',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frame-checklist-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new ProgressStore(dir,()=>now);store.update(fixture());const original=fs.readFileSync(store.file,'utf8');
 for(const change of [r=>r.publishable=false,r=>r.proposalVersion=1,r=>delete r.publishable,r=>r.sections[0].coverage='example-only',r=>r.sections[0].items[0].status='completed',r=>r.sections[0].items[0].checklistChecked=true,r=>r.sections.push(r.sections[0]),r=>r.sections[0].items.push(r.sections[0].items[0]),r=>r.sections[0].items[0].milestones[0].status='busy',r=>r.sections[0].items[0].milestones[0].stages.live='yes',r=>r.sections[0].items[0].milestones[6].at=r.updatedAt,r=>r.sections[0].items[0].milestones[0].at='2026-10-13T00:41:32Z']){
  const r=fixture();change(r);assert.throws(()=>store.update(r),{userError:true});assert.equal(fs.readFileSync(store.file,'utf8'),original);
 }
 assert.deepEqual(new ProgressStore(dir,()=>now).get(),store.get());
});
test('publisher forwards only approved version-2 display fields and rejects proposal markers',()=>{
 const r=fixture();r.sections[0].progress={completed:4,total:7,basis:'fixed-v1',history:[{completed:3,total:7,basis:'fixed-v1',at:'2026-10-12T00:00:00Z',path:'PRIVATE'}]};r.localEvidence={path:'PRIVATE'};r.sections[0].items[0].milestones[0].evidenceRefs=['PRIVATE'];
 const code="import importlib.util,json,sys; spec=importlib.util.spec_from_file_location('publisher',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(json.dumps(m.selected(json.load(sys.stdin))))";
 const run=input=>spawnSync('python3',['-c',code,path.resolve(__dirname,'../../tools/project-progress/publish.py')],{input:JSON.stringify(input),encoding:'utf8'});
 const result=run(r);assert.equal(result.status,0,result.stderr);assert(!result.stdout.includes('PRIVATE'));assert.equal(JSON.parse(result.stdout).sections[0].progress.completed,4);assert.equal(JSON.parse(result.stdout).sections[0].items[0].milestones.length,7);
 assert.notEqual(run({...r,publishable:false}).status,0);assert.notEqual(run({...r,proposalVersion:1}).status,0);
});

test('explicit progress counts, baselines and blocked states validate without closing acceptance',()=>{
 const r=fixture(),section=r.sections[0],item=section.items[0];
 section.totalItems=12;section.progress={completed:7,total:12,basis:'S1-v1',history:[{completed:6,total:12,basis:'S1-v1',at:'2026-10-12T00:00:00Z',path:'PRIVATE'}]};item.status='blocked';item.progress=section.progress;
 const out=cleanReport(r,now);assert.equal(out.sections[0].progress.completed,7);assert.equal(out.sections[0].items[0].status,'blocked');assert.equal(out.sections[0].items[0].checklistChecked,false);assert(!JSON.stringify(out).includes('PRIVATE'));
 for(const change of [r=>r.sections[0].progress.completed=13,r=>r.sections[0].progress.total=0,r=>r.sections[0].progress.basis='',r=>r.sections[0].progress.history[0].at='2026-10-14T00:00:00Z',r=>r.sections[0].totalItems=0,r=>r.sections[0].coverage='complete']){
 const invalid=JSON.parse(JSON.stringify(r));change(invalid);assert.throws(()=>cleanReport(invalid,now),{userError:true});
 }
});
