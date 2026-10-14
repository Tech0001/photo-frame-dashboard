package com.wesbos.homehq;

/** Opt-in local sidebar; never changes the hub or another display's navigation. */
final class HouseholdSidebar {
  static final String SCRIPT = "(function(){"
      + "var rail=document.getElementById('rail');if(!rail)return;"
      + "['nas','agents'].forEach(function(name){var b=rail.querySelector('[data-go=\"'+name+'\"]');if(b)b.style.display='none';});"
      + "if(!document.getElementById('railSpotify')){var b=document.createElement('button');"
      + "b.id='railSpotify';b.className='rail-item';b.setAttribute('aria-label','Spotify');"
      + "b.innerHTML='<svg class=\"i\" width=\"26\" height=\"26\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M6 9c4-1.5 8-1.2 12 1M7 12c3.5-1.1 7-0.8 10 1M8 15c2.8-0.8 5.4-0.5 8 1\"/></svg><span>Spotify</span>';"
      + "b.addEventListener('click',function(){location.href='homehq://spotify';});"
      + "rail.insertBefore(b,document.getElementById('railClock'));}"
      + "if(window.App&&(App.current==='nas'||App.current==='agents'))App.go('home');"
      + "})();";
}
