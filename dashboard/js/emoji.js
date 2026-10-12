// Local SVG emoji work even when Android's system font predates the character.
// Parse text nodes only: event listeners and user-entered markup stay untouched.
import twemoji from '@twemoji/api';

function start() {
  const options = { callback: (icon) => '/emoji/v15.0.0/' + icon + '.svg', className: 'emoji' };
  const skip = 'script,style,textarea,input,select,option,svg,[contenteditable]';
  const roots = new Set();
  let pending = false;
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'characterData') roots.add(change.target.parentElement);
      else for (const node of change.addedNodes) roots.add(node.nodeType === 3 ? node.parentElement : node);
    }
    if (!pending && roots.size) { pending = true; requestAnimationFrame(render); }
  });
  function render() {
    pending = false;
    observer.disconnect();
    for (const root of roots) {
      if (root && root.nodeType === 1 && root.isConnected && !root.closest(skip)) twemoji.parse(root, options);
    }
    roots.clear();
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }
  roots.add(document.body);
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
