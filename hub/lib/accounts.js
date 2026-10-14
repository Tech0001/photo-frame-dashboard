'use strict';
// Subscription usage endpoints are unofficial. Never refresh or rewrite CLI logins.
const shared = require('./account-providers');
const { problem } = require('./util');
function decode(token) { try { return JSON.parse(Buffer.from(token.split('.')[1],'base64url')); } catch { return {}; } }
function parseCodexAuth(text) {
  let value;try {value=JSON.parse(text);}catch{throw problem('Paste Codex auth.json');}
  const tokens=value.tokens || value, access=tokens.access_token;
  if(typeof access!=='string'||access.split('.').length!==3)throw problem('Missing Codex login token');
  const claim=decode(access);
  return {access_token:access,account_id:String(tokens.account_id || claim['https://api.openai.com/auth']?.chatgpt_account_id || ''),saved_at:new Date().toISOString()};
}
async function fetchCodex(credentials,fetcher=fetch) {
  if(decode(credentials.access_token).exp*1000<Date.now())throw problem('Codex login expired; sign in with the CLI again');
  const headers={Authorization:'Bearer '+credentials.access_token,Accept:'application/json','User-Agent':'codex-cli'};
  if(credentials.account_id)headers['ChatGPT-Account-Id']=credentials.account_id;
  const response=await fetcher('https://chatgpt.com/backend-api/wham/usage',{headers,redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw problem(response.status===401||response.status===403?'Codex login rejected':'Codex usage unavailable',502);
  const result=await response.json(), meters=[];
  for(const [name,window] of Object.entries(result.rate_limit || {})) {
    if(!window||typeof window!=='object'||!Number.isFinite(window.used_percent)||!Number.isFinite(window.limit_window_seconds))continue;
    const reset=Number.isFinite(window.reset_at)?window.reset_at*1000:Number.isFinite(window.reset_after_seconds)?Date.now()+window.reset_after_seconds*1000:null;
    meters.push({label:name.includes('secondary')?'Weekly':'Session',used:Math.max(0,Math.min(100,window.used_percent)),win:window.limit_window_seconds/60,resetAt:reset,leftMin:reset?Math.max(0,(reset-Date.now())/60000):null});
  }
  if(!meters.length)throw problem('Codex returned no recognized usage windows',502);
  return {plan:String(result.plan_type || 'ChatGPT'),meters};
}
const providers={codex:{id:'codex',name:'Codex',color:'#10A37F',defaultPlan:'ChatGPT',unofficial:true,parse:parseCodexAuth,fetch:fetchCodex},claude:shared.claude,openrouter:shared.openrouter};
function status(secrets) { return Object.values(providers).map(provider=>({id:provider.id,name:provider.name,linked:!!secrets.accounts?.[provider.id],source:secrets.accounts?.[provider.id]?.source || 'hub',unofficial:!!provider.unofficial})); }
const flights=new WeakMap();
async function refreshAll(secrets,store) {
  if(flights.has(store))return flights.get(store);
  const job=Promise.all(Object.values(providers).map(async provider=>{
    const credentials=secrets.accounts?.[provider.id];if(!credentials){if(store.get().services.some(s=>s.id===provider.id&&['hub','pc-login'].includes(s.source)))store.removeLinkedService(provider.id);return;}if(credentials.source==='local')return;
    try {const result=await provider.fetch(credentials);store.setService({id:provider.id,name:provider.name,color:provider.color,kind:provider.id==='openrouter'?'credits':'limits',unofficial:!!provider.unofficial,...result},'');}
    catch {store.setService({id:provider.id,name:provider.name,color:provider.color,kind:provider.id==='openrouter'?'credits':'limits',unofficial:!!provider.unofficial},'Could not read account usage. Check or refresh the login.');}
  })).finally(()=>flights.delete(store));flights.set(store,job);return job;
}
module.exports={providers,status,refreshAll,parseCodexAuth,fetchCodex};
