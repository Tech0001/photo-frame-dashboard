'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHub}=require('../server');const integration=require('../integrations/agents');const accounts=require('../lib/accounts');
test('Codex reader reports only provider windows and preserves unknown resets',async()=>{
 const jwt='h.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+3600})).toString('base64url')+'.s';const creds=accounts.parseCodexAuth(JSON.stringify({tokens:{access_token:jwt,refresh_token:'discard'}}));assert(!JSON.stringify(creds).includes('discard'));
 const result=await accounts.fetchCodex(creds,async()=>({ok:true,json:async()=>({plan_type:'pro',rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000}}})}));assert.equal(result.meters[0].used,25);assert.equal(result.meters[0].leftMin,null);assert.equal(result.meters[0].win,300);
 await assert.rejects(()=>accounts.fetchCodex(creds,async()=>({ok:true,json:async()=>({unexpected:25})})),/no recognized/);
});
test('Agents integration rejects anonymous publishing and keeps connection credentials write-only',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-agent-route-'));const cfg={dataDir:dir,photosDir:path.join(dir,'photos'),cacheDir:path.join(dir,'cache'),dashboardDir:dir,timezone:'UTC',calendars:[],weather:null};const secrets={admin_password:'admin-test',agents_token:'publisher-test'};
 const hub=createHub({loaded:{cfg,secrets,cfgFile:path.join(dir,'config.json'),secFile:path.join(dir,'secrets.json')},plugins:[integration]});await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>hub.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+hub.server.address().port;const headers={'Content-Type':'application/json'},body=JSON.stringify({services:[{id:'claude',name:'Claude',kind:'limits',meters:[{label:'Weekly',used:10,win:10080}]}]});
 assert.equal((await fetch(url+'/api/agents',{method:'PUT',headers,body})).status,401);
 assert.equal((await fetch(url+'/api/agents',{method:'PUT',headers:{...headers,'x-agent-token':secrets.agents_token},body})).status,200);
 const data=await (await fetch(url+'/api/state')).json();assert.equal(data.agents.services[0].id,'claude');assert(!JSON.stringify(data).includes('publisher-test'));
 const admin={...headers,Authorization:'Basic '+Buffer.from('admin:admin-test').toString('base64')};
 const response=await fetch(url+'/api/admin/connections',{headers:admin});assert(!JSON.stringify(await response.json()).includes('publisher-test'));
});
