// A clock tap opens household settings; the existing hold still opens demo controls.
(function () {
  'use strict';
  var loading=false;
  function readLocal(){try{return JSON.parse(localStorage.getItem('frame-display-settings') || '{}');}catch{return {};}}
  function options(values,current){if(values.indexOf(current)<0)values=values.concat([current]).sort(function(a,b){return a-b;});return values.map(function(n){return '<option value="'+n+'"'+(n===current?' selected':'')+'>'+ (n<60?n+' seconds':n/60+(n===60?' minute':' minutes'))+'</option>';}).join('');}
  App.validateDisplayTimers=function(home,ambient){return Number.isFinite(home)&&Number.isFinite(ambient)&&home>=5&&ambient>home&&ambient<=86400;};
  function show(settings){
    if(App.$('#demo').classList.contains('is-open'))return;
    App.resetIdle();var values=settings.values,selected=values.theme || 'paper',saving=false,themes=App.themes || [];
    var picker=themes.length?'<div class="ds-themes" role="group" aria-label="Color theme">'+themes.map(function(p){return '<button data-display-theme="'+p.id+'" aria-pressed="'+(p.id===selected)+'" style="--sample-bg:'+p.colors.paper+';--sample-card:'+p.colors.card+';--sample-ink:'+p.colors.ink+';--sample-accent:'+p.colors.accent+'"><span class="ds-sample"><i></i><b>10:24</b></span><span>'+App.esc(p.label)+'</span></button>';}).join('')+'</div>':'';
    App.sheet('<h2 class="serif">Display settings</h2><p class="ds-intro">'+App.esc(settings.profile?settings.profile.name+' profile':'Choose when the dashboard returns and starts its slideshow.')+'</p>'+picker+'<div class="ds-timers"><label>Back to Today after<select data-display-home>'+options([15,30,60,120,300],values.homeSec)+'</select></label><label>Start slideshow after<select data-display-ambient>'+options([30,60,120,180,300,600,1800],values.ambientSec)+'</select></label></div><p class="ds-status" role="status"></p><div class="ds-actions"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--solid" data-display-save>Apply</button></div>',{cls:'sheet--display-settings',onClose:App.resetIdle,onMount:function(root,close){
      root.addEventListener('click',async function(e){
        var choice=e.target.closest('[data-display-theme]');if(choice&&!saving){selected=choice.dataset.displayTheme;root.querySelectorAll('[data-display-theme]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.displayTheme===selected));});}
        if(!e.target.closest('[data-display-save]')||saving)return;
        var next={homeSec:Number(root.querySelector('[data-display-home]').value),ambientSec:Number(root.querySelector('[data-display-ambient]').value)};if(themes.length)next.theme=selected;
        var status=root.querySelector('.ds-status');if(!App.validateDisplayTimers(next.homeSec,next.ambientSec)){status.textContent='Choose a slideshow time later than the return to Today.';return;}
        saving=true;status.textContent='Saving…';root.querySelectorAll('button,select').forEach(function(b){b.disabled=true;});
        var control=typeof AbortController==='function'?new AbortController():null, timeout=control?setTimeout(function(){control.abort();},10000):null;
        try{
          if(App.live){var response=await fetch(window.DashboardDisplay?DashboardDisplay.url('/api/display-settings'):'/api/display-settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Display-Token':settings.token},body:JSON.stringify({values:next}),signal:control?control.signal:undefined});var result=await response.json();if(!response.ok)throw Error(result.error || 'Could not save settings');next=result.values;}
          else localStorage.setItem('frame-display-settings',JSON.stringify(Object.assign(readLocal(),next)));
          window.TUNE=Object.assign({},window.TUNE || {},next);App.idle.home=next.homeSec;App.idle.ambient=next.ambientSec;App.emit('tune',window.TUNE);if(App.setTheme&&next.theme)App.setTheme(next.theme);
          if(root.isConnected)close();App.toast('Display settings saved',{ms:2500});
        }catch(error){saving=false;if(root.isConnected){status.textContent=error.name==='AbortError'?'Save timed out. Reopen settings to check the saved values.':error.message;root.querySelectorAll('button,select').forEach(function(b){b.disabled=false;});}}
        finally{if(timeout)clearTimeout(timeout);}
      });
    }});
  }
  App.openDisplaySettings=async function(){
    if(loading)return;loading=true;
    var control=typeof AbortController==='function'?new AbortController():null, timeout=control?setTimeout(function(){control.abort();},8000):null;
    try{
      if(App.live){var response=await fetch(window.DashboardDisplay?DashboardDisplay.url('/api/display-settings'):'/api/display-settings',{cache:'no-store',signal:control?control.signal:undefined});if(!response.ok)throw Error();show(await response.json());}
      else show({values:Object.assign({homeSec:App.idle.home,ambientSec:App.idle.ambient,theme:'paper'},readLocal(),window.TUNE || {})});
    }catch{App.toast('Could not open settings. Check Wi-Fi and try again.');}
    finally{loading=false;if(timeout)clearTimeout(timeout);}
  };
  App.on('ready',function(){if(!App.live){var saved=readLocal();if(App.validateDisplayTimers(saved.homeSec,saved.ambientSec)){App.idle.home=saved.homeSec;App.idle.ambient=saved.ambientSec;}}});
})();
