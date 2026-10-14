// Opt-in integration check against a paired device; restores its previous workspace.
import assert from 'node:assert/strict';
import {Display,config} from './hub-display.mjs';
if(!process.argv.includes('--live')){console.error('Pass --live to test the configured display.');process.exit(2);}
const display=new Display(await config());let previous;
try {
  await display.attach();
  previous=await display.evaluate('window.__hubWorkspace?window.__hubWorkspace.frame.contentDocument.documentElement.outerHTML:null');
  const origin=await display.evaluate('performance.timeOrigin');
  const doc=n=>`<!doctype html><title>Workspace check</title><body><p id="value">${n}</p><script>const reusedName=${n};window.counter=0;window.testClock=setInterval(()=>window.counter++,20);</script>`;
  await display.show(doc(1));
  assert.equal(await display.evaluate('reusedName',true),1);
  await display.show(doc(2));
  assert.equal(await display.evaluate('reusedName',true),2,'Replacing a document must reset script declarations');
  const frameOrigin=await display.evaluate('performance.timeOrigin',true);
  await display.evaluate('document.querySelector("#value").textContent="edited live"',true);
  assert.equal(await display.evaluate('document.querySelector("#value").textContent',true),'edited live');
  assert.equal(await display.evaluate('performance.timeOrigin',true),frameOrigin,'Live edits must not reload the workspace');
  assert.equal(await display.evaluate('window.__hubWorkspace.frame.hasAttribute("sandbox")'),false);
  await display.evaluate('window.__hubWorkspace.close()');
  assert.equal(await display.evaluate('!!window.__hubWorkspace'),false);
  assert.equal(await display.evaluate('performance.timeOrigin'),origin,'Opening, updating and closing must not reload the dashboard');
  console.log('Live checks passed: repeated documents, live DOM editing, trusted execution, return to dashboard, no dashboard reload.');
} finally {
  if(previous)await display.show(previous).catch(()=>{});
  await display.close();
}
