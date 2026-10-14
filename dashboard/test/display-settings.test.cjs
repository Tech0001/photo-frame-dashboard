const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('restored invalid timers do not shorten or disable the slideshow',()=>{
 const handlers={},App={idle:{home:60,ambient:120},on:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/display-settings.js'),'utf8'),{App,localStorage:{getItem:()=>JSON.stringify({homeSec:300,ambientSec:60})},window:{}});
 handlers.ready();assert.equal(App.idle.home,60);assert.equal(App.idle.ambient,120);
 assert.equal(App.validateDisplayTimers(60,180),true);assert.equal(App.validateDisplayTimers(60,60),false);assert.equal(App.validateDisplayTimers(60,Infinity),false);
});
