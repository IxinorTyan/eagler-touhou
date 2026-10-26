// Build-time adapter: expose the existing browser controller to the managed
// input owner, without adding keyboard emulation inside DOS.
export async function adaptPC98Practice({patch, replaceOnce, game}) {
  await patch('practice-ui.js', text => {
    text = replaceOnce(text, 'return {configuration,', 'return {configuration,handleKey:onKey,show,', 'practice browser controller');
    text = replaceOnce(text, "window.addEventListener('keydown',onKey,true);", '', 'managed practice keyboard ownership');
    text = replaceOnce(text, 'function show(advanced=false){', 'function show(advanced=false){globalThis.__eaglerPC98Input.releaseGameplay();', 'release managed input for practice');
    if (game === 'th05') {
      text = replaceOnce(text, "if(event.ctrlKey||event.metaKey||event.altKey||event.target?.closest?.('input,select,textarea,[contenteditable=\"true\"]'))return;", `if(!panel.hidden&&panel.classList.contains('practice-full')&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      const control=document.activeElement,editable=control?.matches('select,input[type="number"],textarea,[contenteditable="true"]');
      if(['F12','Escape','Tab'].includes(event.code)||!editable&&['ArrowUp','ArrowDown','Enter','Space','KeyZ','KeyX'].includes(event.code)){
        event.preventDefault();event.stopImmediatePropagation();if(event.repeat)return;
        if(['F12','Escape','KeyX'].includes(event.code)){panel.hidden=true;onFocus();}
        else if(['Tab','ArrowUp','ArrowDown'].includes(event.code)){const list=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(n=>n.getClientRects().length),at=list.indexOf(control),step=event.code==='ArrowUp'||event.code==='Tab'&&event.shiftKey?-1:1;const next=list[(at+step+list.length)%list.length];next?.focus({preventScroll:true});next?.scrollIntoView({block:'nearest'});}
        else if(panel.contains(control))control.click();return;
      }
      if(editable){event.stopImmediatePropagation();return;}
    }
    if(event.ctrlKey||event.metaKey||event.altKey||event.target?.closest?.('input,select,textarea,[contenteditable="true"]'))return;`, 'practice form keyboard isolation');
    }
    return text;
  });
}
