'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const{createHub}=require('../server'),voice=require('../integrations/voice');
test('voice requires an enabled display and scoped token; quick replies only navigate permitted pages',async t=>{
 const worker=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+'a'.repeat(64));let raw='';for await(const b of req)raw+=b;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/health'?{ok:true}:{answer:JSON.parse(raw).text,audio:'UklGRg==',mime:'audio/wav'}));});await new Promise(r=>worker.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-voice-')),cfg={timezone:'UTC',dataDir:dir,cacheDir:path.join(dir,'cache'),photosDir:path.join(dir,'photos'),dashboardDir:dir,calendars:[],weather:null,voice:{enabled:true,workerUrl:'http://127.0.0.1:'+worker.address().port,conversation:false}};
 const hub=createHub({loaded:{cfg,secrets:{admin_password:'test',voice_local_token:'a'.repeat(64)},cfgFile:path.join(dir,'cfg'),secFile:path.join(dir,'sec')},plugins:[voice]});await new Promise(r=>hub.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>hub.server.close(r));await new Promise(r=>worker.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+hub.server.address().port,request=(url,method='GET',body,headers={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 await request('/api/displays/register','POST',{id:'frame',kind:'frame'});await request('/api/displays/register','POST',{id:'echo',kind:'echo'});
 assert.equal((await request('/api/voice/status?display=frame')).status,403);
 const status=await(await request('/api/voice/status?display=echo')).json();assert(status.ready);
 assert.equal((await request('/api/voice/text?display=echo','POST',{text:'show shopping'})).status,403);
 const r=await request('/api/voice/text?display=echo','POST',{text:'show shopping'},{'X-Voice-Token':status.token});assert.equal(r.status,200);const result=await r.json();assert.deepEqual(result.action,{type:'navigate',tab:'shopping'});assert.equal(result.mime,'audio/wav');
 assert.equal((await request('/api/voice/text?display=echo','POST',{text:'show shopping'},{'X-Voice-Token':status.token,Origin:'https://foreign.example'})).status,403);
 const admin=await(await request('/api/admin/connections','GET',undefined,{Authorization:'Basic '+Buffer.from('admin:test').toString('base64')})).json();assert(!JSON.stringify(admin).includes('a'.repeat(64)));
 assert.equal((await request('/api/admin/connections','PUT',{voice:{workerUrl:'https://remote.example'}},{Authorization:'Basic '+Buffer.from('admin:test').toString('base64')})).status,400);
});
test('local dashboard commands cannot request shell execution or navigate a hidden tab',()=>{assert.equal(voice.builtin('run reboot',{},[]),null);assert.equal(voice.builtin('show agents',{},['home']),null);assert.deepEqual(voice.builtin('show photos',{},['home','photos']).action,{type:'navigate',tab:'photos'});});
