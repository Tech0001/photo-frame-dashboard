'use strict';
const crypto=require('node:crypto');
const {AgentsStore}=require('../lib/agents');
const accounts=require('../lib/accounts');
const local=require('../lib/local-accounts');
const {equalSecret}=require('../lib/util');
function install(ctx) {
  const {cfg,secrets,route,problem}=ctx, store=new AgentsStore(cfg.dataDir);
  ctx.addState(()=>({agents:store.get()}));
  route('GET','/api/agents',()=>store.get());
  route('POST','/api/agents/refresh',()=>{const requestedAt=store.request();accounts.refreshAll(secrets,store);return {ok:true,requestedAt};});
  route('PUT','/api/agents',({req,body})=>{if(!equalSecret(req.headers['x-agent-token'],secrets.agents_token))throw problem('Invalid account publisher token',401);store.update(body);return {ok:true};});
  route('GET','/api/accounts/local',()=>({providers:local.enabled(secrets),requestedAt:store.get().requestedAt}));
  route('PUT','/api/accounts/local',({req,body})=>{local.authorize(req,secrets);return local.publish(body,secrets,store);});
  route('POST','/api/admin/accounts/token',({body})=>{const key=body.kind==='local'?'local_accounts_token':'agents_token';secrets[key]=crypto.randomBytes(32).toString('hex');ctx.saveFiles();return {token:secrets[key]};},{admin:true});
  ctx.settings('accounts',{
    view:()=>({providers:accounts.status(secrets),localSyncTokenSet:!!secrets.local_accounts_token,publisherTokenSet:!!secrets.agents_token}),
    save:input=>{
      if(!input||typeof input!=='object'||Array.isArray(input))throw problem('Invalid account settings');
      const next={...secrets.accounts};
      for(const [id,value] of Object.entries(input)){
        const provider=accounts.providers[id];if(!provider)throw problem('Unknown provider');
        if(value.unlink)delete next[id];
        else if(value.source==='local'){if(!['codex','claude'].includes(id)||!secrets.local_accounts_token)throw problem('Generate a local sync token first');next[id]={source:'local'};}
        else if(value.authJson && value.authJson.trim())next[id]=provider.parse(value.authJson);
      }
      secrets.accounts=next;
      for(const provider of Object.values(accounts.providers))if(!next[provider.id])store.removeLinkedService(provider.id);
    }
  });
  const timer=setInterval(()=>accounts.refreshAll(secrets,store),5*60000);timer.unref();ctx.onClose(()=>clearInterval(timer));
}
module.exports={install};
