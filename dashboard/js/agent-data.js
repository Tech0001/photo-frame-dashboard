(function(){
  'use strict';
  var D=window.DATA, lastRequest=0;
  var definitions=[{id:'codex',name:'Codex',color:'#10A37F',rgb:'16 163 127'},{id:'claude',name:'Claude',color:'#D97757',rgb:'217 119 87'},{id:'openrouter',name:'OpenRouter',color:'#635BFF',rgb:'99 91 255'}];
  App.on('hub-state',function(state){
    var payload=state.agents || {services:[]}, now=Date.now(), latest=0;
    var rows=definitions.map(function(base){
      var service=(payload.services || []).filter(function(s){return s.id===base.id;})[0];
      var row=Object.assign({},base,{plan:'',status:'off',meters:[],tokens:0,cost:0,week:[0,0,0,0,0,0,0],note:'Connect this account in Hub → Connections.'});
      if(!service)return row;
      row.plan=service.plan || '';row.updated=Date.parse(service.updated || '') || 0;latest=Math.max(latest,row.updated);
      row.status='on';row.incident=service.error || '';row.limits=service.kind==='limits';row.credits=service.credits;
      row.meters=(service.meters || []).map(function(m){return {label:m.label,used:m.used,win:m.win,resetAt:m.resetAt || (m.leftMin===null ? null:row.updated+m.leftMin*60000),left:m.leftMin || 0,unknownReset:m.leftMin===null && !m.resetAt};});
      row.note=service.error || (service.unofficial ? 'Unofficial subscription usage reader.':'Reported usage for this key.');return row;
    });
    D.agents.splice.apply(D.agents,[0,D.agents.length].concat(rows));D.agentsUpdated=latest;D.agentsRequestedAt=Date.parse(payload.requestedAt || '') || 0;
  });
  window.liveRefreshAgents=function(silent){
    if(silent && Date.now()-lastRequest<60000)return;lastRequest=Date.now();D.agentsRequestedAt=Date.now();
    fetch('/api/agents/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(function(){App.toast('Could not refresh account usage.');});
  };
})();
