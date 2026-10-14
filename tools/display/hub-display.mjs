#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {watch} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, resolve, extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {showWorkspace, workspaceExpression} from './workspace.mjs';
const execute = promisify(execFile);
const pause = ms => new Promise(r => setTimeout(r,ms));
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

export async function config() {
  let file={};
  try {file=JSON.parse(await readFile(process.env.HUB_DISPLAY_CONFIG || `${homedir()}/.config/hub-display/config.json`,'utf8'));}
  catch(e) {if(e.code!=='ENOENT')throw e;}
  return {...file,adb:process.env.HUB_DISPLAY_ADB||file.adb||'adb',device:process.env.HUB_DISPLAY_DEVICE||file.device,package:file.package||'com.wesbos.homehq'};
}
export class Display {
  constructor(options) {this.options=options;}
  async adb(args,binary=false) {
    if(!this.options.device)throw Error('Set HUB_DISPLAY_DEVICE or device in ~/.config/hub-display/config.json');
    const result=await execute(this.options.adb,['-s',this.options.device,...args],{encoding:binary?'buffer':'utf8',maxBuffer:32*1024*1024,timeout:30000});
    return result.stdout;
  }
  async attach() {
    if(this.options.device?.includes(':'))await execute(this.options.adb,['connect',this.options.device],{timeout:10000});
    await this.adb(['shell',`am start -a android.intent.action.MAIN -c android.intent.category.HOME -n ${quote(this.options.package+'/.MainActivity')} --ez debug true`]);
    for(let i=0;i<20;i++) {
      const pid=(await this.adb(['shell',`pidof ${quote(this.options.package)}`])).trim().split(/\s+/)[0];
      if(!/^\d+$/.test(pid)){await pause(200);continue;}
      const port=(await this.adb(['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`])).trim();
      try {
        const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)});
        const targets=await response.json();
        const target=targets.find(t=>t.type==='page'&&!t.url.startsWith('devtools:'));
        if(!target)throw Error('No kiosk page found');
        const url=new URL(target.webSocketDebuggerUrl);url.hostname='127.0.0.1';url.port=port;
        this.port=port;this.target=target;this.socket=new WebSocket(url);
        await new Promise((ok,no)=>{
          const timer=setTimeout(()=>no(Error('Debugger connection timed out')),4000);
          this.socket.onopen=()=>{clearTimeout(timer);ok();};
          this.socket.onerror=()=>{clearTimeout(timer);no(Error('Debugger connection failed'));};
        });
        this.pending=new Map();this.sequence=0;
        this.socket.onmessage=event=>{
          const message=JSON.parse(event.data),pending=this.pending.get(message.id);
          if(!pending)return;
          clearTimeout(pending.timer);this.pending.delete(message.id);
          if(message.error)pending.reject(Error(message.error.message));else pending.resolve(message.result);
        };
        this.socket.onclose=()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Display connection closed'));}this.pending.clear();};
        return {device:this.options.device,title:target.title,url:target.url};
      } catch(e) {
        if(this.socket){this.socket.close();this.socket=null;}
        await this.adb(['forward','--remove',`tcp:${port}`]).catch(()=>{});
        if(i===19)throw e;await pause(200);
      }
    }
    throw Error('Kiosk did not start');
  }
  async call(method,params={}) {
    if(!this.socket||this.socket.readyState!==WebSocket.OPEN)throw Error('Display is not connected');
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`${method} timed out`));},30000);
      this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  async evaluate(expression,workspace=false) {
    const result=await this.call('Runtime.evaluate',{expression:workspace?workspaceExpression(expression):expression,returnByValue:true,awaitPromise:true,userGesture:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    if(result.result.type==='undefined')return null;
    return result.result.value??result.result.description;
  }
  async show(html) {return this.evaluate(`(${showWorkspace.toString()})(${JSON.stringify(html)})`);}
  async close() {
    if(this.socket){this.socket.close();this.socket=null;}
    if(this.port){await this.adb(['forward','--remove',`tcp:${this.port}`]).catch(()=>{});this.port=null;}
  }
}
const help=`hub-display — live control of a paired Android display (Node 22+)
  status                         Read the live page and workspace state
  show FILE.html                 Paint arbitrary HTML/CSS/JS over the dashboard
  watch FILE.html                Republish edits until Ctrl-C (keeps display open)
  eval 'JAVASCRIPT'               Run code in the current kiosk page
  eval --workspace 'JAVASCRIPT'   Run code inside the live workspace
  eval --file FILE.js            Read code from a file (also accepts --workspace)
  cdp METHOD '{"params":true}'    Call any Chrome DevTools protocol method
  play FILE.wav                  Play local audio on the display
  adb ARGS...                    Pass any command to the paired ADB device
  screenshot FILE.png            Capture the entire Android screen
  tap X Y                        Tap the Android screen
  swipe X1 Y1 X2 Y2 [MS]          Swipe/scroll, including native apps
  key KEYCODE                    Send an Android key (e.g. BACK, HOME)
  shell 'COMMAND'                Run any command as the paired ADB shell
  push LOCAL REMOTE              Copy a file to Android
  pull REMOTE LOCAL              Copy a file from Android
  clear                          Close the live workspace and return to dashboard
  detach                         Disable WebView debugging; does not stop ADB

Set device/adb in ~/.config/hub-display/config.json or HUB_DISPLAY_DEVICE/ADB.
Content is trusted local code with full page access. No model or cloud API needed.
The CLI uses the existing authenticated ADB pairing; it creates no LAN listener.
`;
export async function main(args) {
  const [command,...rest]=args;
  if(!command||['help','--help','-h'].includes(command)){console.log(help);return;}
  const display=new Display(await config());
  const output=value=>console.log(typeof value==='string'?value:JSON.stringify(value,null,2));
  const requireArgs=n=>{if(rest.length<n)throw Error(`Missing arguments for ${command}; see --help`);};
  if(command==='screenshot') {
    requireArgs(1);const destination=resolve(rest[0]);await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,await display.adb(['exec-out','screencap','-p'],true));output(destination);return;
  }
  if(command==='adb'){requireArgs(1);output(await display.adb(rest));return;}
  if(command==='shell'){requireArgs(1);output(await display.adb(['shell',rest.join(' ')]));return;}
  if(command==='push'||command==='pull'){requireArgs(2);output(await display.adb([command,rest[0],rest[1]]));return;}
  if(['tap','swipe','key'].includes(command)) {
    requireArgs(command==='tap'?2:command==='swipe'?4:1);
    if(rest.some(a=>!/^[-\w.]+$/.test(a)))throw Error('Invalid input argument');
    output(await display.adb(['shell',`input ${command==='key'?'keyevent':command} ${rest.map(quote).join(' ')}`]));return;
  }
  if(command==='detach'){
    output(await display.adb(['shell',`am start -a android.intent.action.MAIN -c android.intent.category.HOME -n ${quote(display.options.package+'/.MainActivity')} --ez debug false`]));return;
  }
  try {
    await display.attach();
    if(command==='status')output(await display.evaluate(`({url:location.href,title:document.title,width:innerWidth,height:innerHeight,workspace:!!window.__hubWorkspace,workspaceTitle:window.__hubWorkspace?window.__hubWorkspace.frame.contentDocument.title:null})`));
    else if(command==='play'){
      requireArgs(1);const bytes=await readFile(rest[0]);
      if(bytes.length>16*1024*1024)throw Error('Use an audio file smaller than 16 MB');
      const mime={'.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.m4a':'audio/mp4'}[extname(rest[0]).toLowerCase()];
      if(!mime)throw Error('Use WAV, MP3, OGG or M4A audio');
      const source=`data:${mime};base64,${bytes.toString('base64')}`;
      output(await display.evaluate(`(async()=>{const target=window.__hubWorkspace?window.__hubWorkspace.frame.contentWindow:window;if(target.__hubLiveAudio)target.__hubLiveAudio.pause();const audio=target.__hubLiveAudio=new target.Audio(${JSON.stringify(source)});target.dispatchEvent(new target.CustomEvent('hub-audio',{detail:audio}));await audio.play();return {playing:true};})()`));
    }
    else if(command==='eval'){
      const workspace=rest.includes('--workspace'),file=rest.includes('--file');
      const values=rest.filter(v=>!['--workspace','--file'].includes(v));
      if(!values.length)throw Error('Supply JavaScript or --file path');
      output(await display.evaluate(file?await readFile(values[0],'utf8'):values.join(' '),workspace));
    }else if(command==='cdp'){requireArgs(1);output(await display.call(rest[0],rest[1]?JSON.parse(rest[1]):{}));}
    else if(command==='clear')output(await display.evaluate(`(()=>{if(window.__hubWorkspace)window.__hubWorkspace.close();return {cleared:true};})()`));
    else if(command==='show'||command==='watch'){
      requireArgs(1);const file=resolve(rest[0]);
      const update=async()=>output(await display.show(await readFile(file,'utf8')));
      await update();
      if(command==='watch'){
        let timer,chain=Promise.resolve();
        const watcher=watch(dirname(file),(_event,name)=>{
          if(name&&resolve(dirname(file),String(name))!==file)return;
          clearTimeout(timer);timer=setTimeout(()=>{chain=chain.then(update).catch(e=>console.error(e.message));},150);
        });
        console.error(`Watching ${file}. Ctrl-C leaves the workspace visible.`);
        await new Promise(ok=>{process.once('SIGINT',ok);process.once('SIGTERM',ok);});
        watcher.close();clearTimeout(timer);await chain;
      }
    }else throw Error('Unknown command; see --help');
  } finally {await display.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
