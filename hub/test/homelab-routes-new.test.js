'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHub}=require('../server');const integration=require('../integrations/homelab');
test('Homelab settings preserve secrets, validate updates, and do not reuse Pi-hole passwords for another host',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-lab-'));const cfg={timezone:'UTC',dataDir:dir,cacheDir:path.join(dir,'cache'),photosDir:path.join(dir,'photos'),dashboardDir:dir,weather:null,calendars:[]},secrets={admin_password:'test-admin'};
 const hub=createHub({loaded:{cfg,secrets,cfgFile:path.join(dir,'config.json'),secFile:path.join(dir,'secrets.json')},plugins:[integration]});await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>hub.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+hub.server.address().port,headers={'Content-Type':'application/json',Authorization:'Basic '+Buffer.from('admin:test-admin').toString('base64')};
 const write=async homelab=>fetch(base+'/api/admin/connections',{method:'PUT',headers,body:JSON.stringify({homelab})});
 const password='application-password-test';assert.equal((await write({pihole:'http://pi.example',piholeVersion:'6',piholePassword:password})).status,200);
 const view=await(await fetch(base+'/api/admin/connections',{headers})).json();assert(view.homelab.piholePasswordSet);assert(!JSON.stringify(view).includes(password));assert(!await fs.readFile(path.join(dir,'config.json'),'utf8').then(text=>text.includes(password)));
 assert.equal((await write({pihole:'http://other.example'})).status,400);assert.equal(cfg.homelab.pihole,'http://pi.example/');assert.equal(secrets.homelab_pihole_password,password);
 assert.equal((await write({piholeUnlink:true})).status,200);assert.equal(secrets.homelab_pihole_password,undefined);
 assert.equal((await fetch(base+'/api/admin/pihole',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reboot'})})).status,401);
});
