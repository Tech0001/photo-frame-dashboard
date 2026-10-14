// Each browser has a stable identity; Hub owns the profile assigned to it.
(function () {
  'use strict';
  var key='homehq-display-id', query=new URLSearchParams(location.search), identifier=query.get('display'), ua=navigator.userAgent;
  if(!identifier) {
    try { identifier=localStorage.getItem(key); } catch (_) {}
    if(!identifier) { var bytes=new Uint8Array(12);crypto.getRandomValues(bytes);identifier='display-'+Array.from(bytes,function(n){return n.toString(16).padStart(2,'0');}).join('');try{localStorage.setItem(key,identifier);}catch(_){} }
  }
  var kind=/Android 6(?:\.0)?/.test(ua)?'frame':/crown|Echo Show/i.test(ua)||identifier==='echo-show'?'echo':'browser';
  var display=window.DashboardDisplay={id:identifier,kind:kind,profile:null,url:function(path){return path+(path.indexOf('?')<0?'?':'&')+'display='+encodeURIComponent(identifier);},register:function(){return fetch('/api/displays/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:identifier,kind:kind,name:kind==='frame'?'Picture frame':kind==='echo'?'Echo Show':'Browser',capabilities:{microphone:kind==='echo',spotify:kind==='echo'}})}).then(function(r){if(!r.ok)throw Error('Display registration failed');return r.json();});}};
  display.apply=function(profile){
    display.profile=profile;
    if(!window.App||!profile)return;
    var rail=document.getElementById('rail');
    [['spotify','Spotify','music']].forEach(function(item){
      if(rail.querySelector('[data-profile-tab="'+item[0]+'"]'))return;
      var b=document.createElement('button');b.className='rail-item';b.dataset.profileTab=item[0];b.innerHTML=App.icon(item[2],26)+'<span>'+item[1]+'</span>';
      b.onclick=function(){App.resetIdle();if(item[0]==='spotify'){if(display.kind==='echo')location.href='homehq://spotify';else App.toast('Spotify needs to be installed on this display.');}else if(App.openVoice)App.openVoice();};
      rail.insertBefore(b,document.getElementById('railClock'));
    });
    rail.querySelectorAll('[data-go],[data-profile-tab]').forEach(function(b){var name=b.dataset.go||b.dataset.profileTab;b.style.display='';b.hidden=profile.tabs.indexOf(name)<0||(name==='voice'&&!App.openVoice);});
    if(profile.tabs.indexOf(App.current)<0)App.go('home');
    document.querySelectorAll('#railSpotify').forEach(function(b){b.remove();});
  };
})();
