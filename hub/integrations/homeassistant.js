'use strict';
const ha=require('../lib/homeassistant');
function install(ctx) {
  const {cfg,secrets,route,send,problem}=ctx;cfg.homeassistant=ha.cleanSettings(cfg.homeassistant || ha.defaults());
  route('GET','/api/home',async()=>{const data=await ha.get(cfg,secrets);return {...data,controlToken:data.controls?ha.controlToken(cfg,secrets):null};});
  route('POST','/api/home/climate',async({req,res,body})=>{ha.authorizeControl(req,cfg,secrets);const result=await ha.act(cfg,secrets,body);send(res,202,result);});
  route('GET','/api/home/camera',async({url,res})=>{const result=await ha.camera(cfg,secrets,url.searchParams.get('entity') || '');send(res,200,result.body,{'Content-Type':result.type,'Cache-Control':'no-store'});});
  route('GET','/api/admin/homeassistant/entities',()=>ha.discover(cfg,secrets),{admin:true});
  ctx.settings('homeassistant',{
    view:()=>({...cfg.homeassistant,tokenSet:!!secrets.homeassistant_token}),
    save:input=>{
      if(!input||typeof input!=='object'||Array.isArray(input))throw problem('Invalid Home Assistant settings');
      const next=ha.cleanSettings({...cfg.homeassistant,...input});
      if(next.url!==cfg.homeassistant.url&&secrets.homeassistant_token&&!input.token&&!input.unlink)throw problem('Enter a new token when changing the Home Assistant host');
      const token=input.unlink?null:input.token?ha.cleanToken(input.token):secrets.homeassistant_token;
      cfg.homeassistant=next;if(token)secrets.homeassistant_token=token;else delete secrets.homeassistant_token;ha.clear();
    }
  });
}
module.exports={install};
