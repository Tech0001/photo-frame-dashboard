// Runs inside the kiosk page. Content is trusted code authored on the paired PC.
export function showWorkspace(html) {
  if (!window.__hubWorkspace) {
    const host = document.createElement('div');
    host.id = 'hub-live-workspace';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b111a;isolation:isolate';
    const frame = document.createElement('iframe');
    frame.title = 'Live workspace';
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#0b111a';
    const close = document.createElement('button');
    close.textContent = 'Dashboard ×';
    close.style.cssText = 'position:absolute;right:12px;top:10px;z-index:2;padding:9px 14px;border:1px solid rgba(255,255,255,.33);border-radius:18px;background:rgba(24,32,46,.91);color:white;font:14px sans-serif;cursor:pointer';
    const keepAwake = () => { if (window.App && App.resetIdle) App.resetIdle(); };
    keepAwake();
    const timer = setInterval(keepAwake, 10000);
    window.__hubWorkspace = {host, frame, close: function () {
      clearInterval(timer);host.remove();delete window.__hubWorkspace;
      keepAwake();if (window.App && App.setMode) App.setMode('day');
    }};
    close.onclick = window.__hubWorkspace.close;
    host.append(frame, close);document.body.appendChild(host);
  }
  // No sandbox attribute: this is the owner's live code workspace, not untrusted content.
  const previous = window.__hubWorkspace.frame;
  const frame = previous.cloneNode(false);
  window.__hubWorkspace.frame = frame;
  return new Promise(resolve => {
    frame.onload = () => resolve({shown:true,width:innerWidth,height:innerHeight});
    frame.srcdoc = html;
    previous.replaceWith(frame);
  });
}

export function workspaceExpression(expression) {
  return `(() => {if(!window.__hubWorkspace)throw Error('No live workspace is open');return window.__hubWorkspace.frame.contentWindow.eval(${JSON.stringify(expression)});})()`;
}
