'use strict';
const lab=require('../lib/homelab');
const management=require('../lib/pihole-management');
function install(ctx) {
  const {cfg,secrets,route,problem}=ctx;cfg.homelab=lab.cleanSettings(cfg.homelab || lab.defaults());
  route('GET','/api/homelab',({url})=>lab.get(cfg,{secrets,refresh:url.searchParams.get('refresh')==='1'}));
  route('GET','/api/admin/pihole',()=>management.status(cfg.homelab.piholeSsh),{admin:true});
  route('POST','/api/admin/pihole',async({body})=>{const result=await management.action(cfg.homelab.piholeSsh,body.action,body.confirm);lab.clear();return result;},{admin:true});
  ctx.settings('homelab',{
    view:()=>({...cfg.homelab,piholeTokenSet:!!secrets.homelab_pihole_token,piholePasswordSet:!!secrets.homelab_pihole_password,giteaTokenSet:!!secrets.homelab_gitea_token,githubTokenSet:!!secrets.homelab_github_token}),
    save:input=>{
      if(!input||typeof input!=='object'||Array.isArray(input))throw problem('Invalid Homelab settings');
      const settings=lab.cleanSettings({...cfg.homelab,...input}), next={...secrets};
      for(const [field,key] of Object.entries({piholeToken:'homelab_pihole_token',piholePassword:'homelab_pihole_password',giteaToken:'homelab_gitea_token',githubToken:'homelab_github_token'})) {
        if(input[field]===null)delete next[key];else if(typeof input[field]==='string'&&input[field])next[key]=field==='piholePassword'?lab.cleanPassword(input[field]):lab.cleanToken(input[field]);
      }
      for (const [field,key] of Object.entries({pihole:'homelab_pihole_token',gitea:'homelab_gitea_token',github:'homelab_github_token'})) if (settings[field] !== cfg.homelab[field] && !input[{pihole:'piholeToken',gitea:'giteaToken',github:'githubToken'}[field]]) delete next[key];
      if (settings.pihole !== cfg.homelab.pihole && secrets.homelab_pihole_password && !input.piholePassword && !input.piholeUnlink) throw problem('Enter the Pi-hole password again for the new host');
      if (input.piholeUnlink) { delete next.homelab_pihole_token; delete next.homelab_pihole_password; }
      cfg.homelab=settings;Object.assign(secrets,next);for(const key of ['homelab_pihole_token','homelab_pihole_password','homelab_gitea_token','homelab_github_token'])if(!Object.hasOwn(next,key))delete secrets[key];lab.clear();
    }
  });
}
module.exports={install};
