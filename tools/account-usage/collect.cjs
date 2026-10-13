#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {providers}=require('../../hub/lib/accounts');
function load(file){const raw=fs.readFileSync(file);if(raw.length>131072)throw Error('Oversized configuration or credential file.');return JSON.parse(raw);}
async function collect(config,fetcher=fetch){
 const hub=new URL(config.hub);if(!['http:','https:'].includes(hub.protocol)||hub.username||hub.password||hub.search||hub.hash)throw Error('Use the plain household hub address.');
 const tokenPath=config.tokenFile,meta=fs.statSync(tokenPath);if(meta.uid!==process.getuid()||(meta.mode&0o077))throw Error('Sync token must belong to this user with mode 0600.');
 const token=fs.readFileSync(tokenPath,'utf8').trim();if(!/^[a-zA-Z0-9_-]{24,128}$/.test(token))throw Error('Invalid sync token file.');
 const endpoint=config.hub.replace(/\/$/,'')+'/api/accounts/local';
 const response=await fetcher(endpoint,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Cannot read local account sync configuration.');
 const state=await response.json();const ids=(state.providers||[]).filter(id=>['codex','claude'].includes(id));if(!ids.length){console.log('No local login feeds selected.');return;}
 let cache={};try{cache=load(config.cacheFile);}catch{}
 const now=Date.now(),mtimes={};ids.forEach(id=>{try{mtimes[id]=fs.statSync(config.credentials[id]).mtimeMs;}catch{mtimes[id]=0;}});
 const requested=Date.parse(state.requestedAt)||0;
 if(now-(cache.fetchedAt||0)<300000&&requested<=(cache.requestedAt||0)&&ids.every(id=>mtimes[id]===(cache.mtimes||{})[id]))return;
 const services=[];
 for(const id of ids){
  let creds;
  try{const raw=fs.readFileSync(config.credentials[id],'utf8');if(Buffer.byteLength(raw)>131072)throw Error();creds=providers[id].parse(raw);}catch{services.push({id,error:'Local login file cannot be read. Sign in on the PC.'});continue;}
  try{const result=await providers[id].fetch(creds);if(!result.meters||!result.meters.length)throw Error();services.push({id,plan:result.plan||providers[id].defaultPlan,meters:result.meters});}
  catch{services.push({id,error:'Local usage check failed. Check the PC login; the last successful reading is retained.'});}
 }
 const r=await fetcher(endpoint,{method:'PUT',redirect:'error',headers:{'Content-Type':'application/json','X-Local-Accounts-Token':token},body:JSON.stringify({services}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('The hub rejected the local usage update.');
 const next={fetchedAt:now,requestedAt:requested,mtimes};fs.mkdirSync(path.dirname(config.cacheFile),{recursive:true,mode:0o700});
 const tmp=config.cacheFile+'.new-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,config.cacheFile);
 console.log('Local account usage published: '+services.map(s=>s.id+(s.error?' (needs attention)':'')).join(', '));
}
if(require.main===module){const i=process.argv.indexOf('--config');if(i<0||!process.argv[i+1]){console.error('Supply --config PATH');process.exitCode=1;}else{let config;try{config=load(process.argv[i+1]);}catch{console.error('Cannot read local account sync configuration.');process.exitCode=1;}if(config)collect(config).catch(()=>{console.error('Local account sync failed. Check the configuration and household connection.');process.exitCode=1;});}}
module.exports={collect};
