"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const ROOT=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(ROOT,file),"utf8");

function acceptedDom() {
  const src=read("tests/p381-sync-open-preview-composition.test.js");
  const start=src.indexOf("function makeDom(");
  const end=src.indexOf("\nasync function composition(",start);
  assert.ok(start>=0&&end>start,"accepted P381 DOM implementation found");
  // Execute P381's accepted real DOM fixture, not a second imitation.
  return new Function(src.slice(start,end)+"\nreturn makeDom;")();
}

function installActualMainHandlers(c) {
  const src=read("js/pocket-overlays-init.js");
  const start=src.indexOf("function handleWindowFocusToTree() {");
  const end=src.indexOf("\nfunction bind() {",start);
  const shortcuts=src.indexOf("  const handleGlobalShortcuts = (ev) => {",end);
  const after=src.indexOf('  window.addEventListener("beforeunload", handlePocketLiteBeforeUnload);',shortcuts);
  assert.ok(start>=0&&end>start&&shortcuts>end&&after>shortcuts,
    "actual Main focus/shortcut handler boundaries");
  const exactFocus=src.slice(start,end);
  const exactShortcuts=src.slice(shortcuts,after);
  assert.match(exactShortcuts,/window\.addEventListener\("keydown", handleGlobalShortcuts/);
  assert.match(exactShortcuts,/document\.addEventListener\("keydown", handleGlobalShortcuts/);
  assert.match(exactShortcuts,/window\.addEventListener\("focus", handleWindowFocusToTree/);
  // These are verbatim handlers and listener registrations from the actual
  // production file. They run in the SAME event and Sync-UI fixture context.
  vm.runInContext(exactFocus+"\nfunction bindActualMainOwners(){\n"
    +exactShortcuts+"\n}\nbindActualMainOwners();",c,
    {filename:"pocket-overlays-init.js (real focus and Main shortcut owners)"});
}

function harness({preview=false,holdOpen=false}={}) {
  const c={Object,Array,String,Boolean,Error,Promise,Map,Set,WeakMap,JSON,Date};
  c.window=c;c.globalThis=c;
  const dom=acceptedDom()(c);
  const doc=dom.doc,winListeners=new Map(),docListeners=new Map(),frames=[];
  c.addEventListener=(name,fn)=>{const v=winListeners.get(name)||[];v.push(fn);winListeners.set(name,v);};
  doc.addEventListener=(name,fn)=>{const v=docListeners.get(name)||[];v.push(fn);docListeners.set(name,v);};
  c.requestAnimationFrame=fn=>{fn();return 1;};
  const counters={save:0,undo:0,palette:0,help:0,filters:0,copies:0,mainFocus:0};
  const tree=dom.doc.body.querySelector("#treeWrap");
  const actualTreeFocus=tree.focus.bind(tree);
  tree.focus=(...args)=>{counters.mainFocus++;actualTreeFocus(...args);};
  const search=doc.createElement("input");search.id="search";doc.body.appendChild(search);
  c.el={treeWrap:tree,search,controlsOverlay:null,pocketOpenOverlay:null,storageOverlay:null};
  c.state={selectedId:null,moveMode:false,focusRootId:null};
  c.isDetailsEditorOpen=()=>false;
  c.isControlsHelpOpen=()=>false;
  c.isCommandPaletteOpen=()=>false;
  c.isRowMiniMenuOpen=()=>false;
  c.openControlsHelp=()=>{counters.help++;return true;};
  c.openCommandPalette=()=>{counters.palette++;return true;};
  c.saveCurrentContext=()=>{counters.save++;};
  c.undoMostRecentTreeMutation=()=>{counters.undo++;};
  c.refocusTreeNavigation=()=>{};
  c.activePendingDeleteNodeId=()=>null;
  c.cleanText=v=>String(v||"").trim();
  c.PocketNativeFilePickerActivity={isActive(){return false;}};
  c.hasPocketUnsavedChanges=()=>false;
  c.capturePocketFileSaveSession=()=>({ownerKind:"json",id:"current"});
  c.canShowPocketTree=()=>true;
  c.closeCommandPalette=()=>false;
  c.PocketNodePopoutWindow={hasUnsavedChanges(){return false;}};
  c.PocketVaultBrowserIo={isDialogOpen(){return false;}};
  c.HTMLElement=dom.doc.body.constructor;
  c.HTMLInputElement=search.constructor;
  c.HTMLButtonElement=dom.buttons.topbar.constructor;
  vm.createContext(c);
  installActualMainHandlers(c);
  vm.runInContext(read("js/pocket-sync-ui.js"),c,{filename:"js/pocket-sync-ui.js"});
  const actualUi=c.PocketSyncUi;
  assert.equal(actualUi.isDialogOpen(),false,"absent installed dialog is closed");
  let resolves=null,openCalls=0,host=null;
  const integration={
    activate(){return Promise.resolve({ok:false});},
    resume(){return Promise.resolve({ok:false});},
    openExisting(){openCalls++;
      return holdOpen?new Promise(resolve=>{resolves=resolve;})
        :Promise.resolve({ok:true,reason:"synced-pocket-opened"});},
    ...(preview?{registerIncomingPreviewHost(incoming){host=incoming;return true;}}:{})
  };
  assert.equal(actualUi.install(integration),true);
  assert.equal(actualUi.install(integration),false,"existing one-install guard");
  const overlay=dom.overlay(),card=overlay.querySelector(".vaultDialogCard");
  assert.ok(overlay&&card&&overlay.querySelector(".vaultDialogPrimary"));
  function dispatch(key,opts={}) {
    const e={key,shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,
      target:opts.target||doc.activeElement||dom.buttons.topbar,
      defaultPrevented:false,stopped:false,
      preventDefault(){this.defaultPrevented=true;},
      stopPropagation(){this.stopped=true;},...opts};
    for(const f of winListeners.get("keydown")||[]){f(e);if(e.stopped)return e;}
    for(const f of docListeners.get("keydown")||[]){f(e);if(e.stopped)return e;}
    return e;
  }
  function windowFocus(){for(const fn of winListeners.get("focus")||[])fn();}
  function open() {
    dom.buttons.topbar.focus();
    dom.buttons.topbar.fire("click");
    assert.equal(actualUi.isDialogOpen(),true);
  }
  function primary(){overlay.querySelector(".vaultDialogPrimary").fire("click");}
  return {c,dom,doc,overlay,card,tree,search,actualUi,integration,
    counters,dispatch,windowFocus,open,primary,
    get openCalls(){return openCalls;},get host(){return host;},
    get resolveOpen(){return resolves;},
    installDeferredFocus(){c.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};},
    flushFrame(){const fn=frames.shift();assert.ok(fn,"queued animation frame");fn();},
    get queuedFrames(){return frames.length;}
  };
}
const keys=[
  {key:"Escape"},{key:"ArrowDown"},{key:"ArrowUp"},{key:"Delete"},
  {key:"Enter"},{key:"s",ctrlKey:true},{key:"z",ctrlKey:true},
  {key:"k",ctrlKey:true},{key:"c",ctrlKey:true},{key:"f",ctrlKey:true},
  {key:"/"},{key:"?"}
];
function actions(v){return {...v.counters};}
function assertMainStill(v,before){assert.deepEqual(v.counters,before,"no actual Main owner side effects");}
function withEventKeys(v){
  const before=actions(v);
  for(const sample of keys){
    const e=v.dispatch(sample.key,sample);
    if(sample.key!=="Escape")assert.equal(e.defaultPrevented,false,
      "Main must yield without consuming "+sample.key);
  }
  assertMainStill(v,before);
}

test("P382 read-only Sync ownership capability reports absent/open/idle-close exactly",()=>{
  const v=harness();
  assert.deepEqual(Object.keys(v.actualUi),[
    "install","refresh","canOpenExisting","canCreateNew","beginCreateNew","isDialogOpen"
  ]);
  assert.equal(Object.isFrozen(v.actualUi),true);
  assert.equal(v.actualUi.isDialogOpen(),false);
  v.open();assert.equal(v.actualUi.isDialogOpen(),true);
  v.overlay.querySelector(".vaultDialogSecondary").fire("click");
  assert.equal(v.actualUi.isDialogOpen(),false);
});

test("P382 actual Main global handlers yield on BOTH captures for ordinary Sync dialog and resume when closed",()=>{
  const v=harness();v.open();
  const before=actions(v);
  for(const key of keys) {
    if(key.key==="Escape")continue;
    const e=v.dispatch(key.key,key);
    assert.equal(e.defaultPrevented,false,"Main must not consume "+key.key);
  }
  assertMainStill(v,before);
  v.dispatch("Escape");
  assert.equal(v.actualUi.isDialogOpen(),false);
  const save=v.dispatch("s",{ctrlKey:true});
  assert.equal(save.defaultPrevented,true);
  assert.equal(v.counters.save,1);
  v.dispatch("/");assert.equal(v.counters.palette,1);
  v.dispatch("?");assert.equal(v.counters.help,1);
});

test("P382 opted-in visual preview stays modal: actual Main handlers yield without new knowledge or document authority",()=>{
  const v=harness({preview:true});
  assert.ok(v.host);
  v.open();
  const token=v.host.begin();
  v.host.mount.appendChild(v.doc.createElement("li"));
  assert.equal(v.host.reveal(token),true);
  assert.equal(v.dom.preview().hidden,false);
  const initial=actions(v),mainRow=v.dom.main.firstChild;
  for(const key of keys.filter(x=>x.key!=="Escape")) {
    const e=v.dispatch(key.key,key);
    assert.equal(e.defaultPrevented,false);
  }
  assertMainStill(v,initial);
  assert.strictEqual(v.dom.main.firstChild,mainRow);
  assert.equal(v.host.mount.childNodes.length,1);
  v.dispatch("Escape");
  assert.equal(v.actualUi.isDialogOpen(),false);
  assert.equal(v.host.mount.childNodes.length,0);
});

test("P382 idle Escape has exactly ONE Sync meaning and returns to the saved origin focus",()=>{
  const v=harness();
  v.dom.buttons.topbar.focus();v.open();
  assert.ok(v.card.contains(v.doc.activeElement));
  const original=actions(v);
  const escape=v.dispatch("Escape");
  assert.equal(escape.defaultPrevented,true);
  assert.equal(escape.stopped,true);
  assert.equal(v.actualUi.isDialogOpen(),false);
  assert.strictEqual(v.doc.activeElement,v.dom.buttons.topbar);
  assertMainStill(v,original);
  v.dispatch("s",{ctrlKey:true});
  assert.equal(v.counters.save,1,"ordinary Main shortcut resumes after close");
});

test("P382 busy Open owns Escape, retains lease and keeps keyboard focus safely within modal",async()=>{
  const v=harness({holdOpen:true});
  v.open();v.primary();
  assert.equal(v.openCalls,1);
  assert.equal(v.actualUi.isDialogOpen(),true);
  assert.equal(v.overlay.querySelector(".vaultDialogPrimary").disabled,true);
  assert.ok(v.card.contains(v.doc.activeElement),"disabled buttons lose focus to card fallback");
  assert.equal(v.doc.activeElement,v.card);
  const previous=actions(v);
  const escape=v.dispatch("Escape");
  assert.equal(escape.defaultPrevented,false);
  assert.equal(v.actualUi.isDialogOpen(),true);
  assert.equal(v.openCalls,1);
  assertMainStill(v,previous);
  const tab=v.dispatch("Tab");
  assert.equal(tab.defaultPrevented,true);
  assert.strictEqual(v.doc.activeElement,v.card);
  const reverse=v.dispatch("Tab",{shiftKey:true});
  assert.equal(reverse.defaultPrevented,true);
  assert.strictEqual(v.doc.activeElement,v.card);
  v.resolveOpen({ok:false,reason:"controlled-failure"});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(v.actualUi.isDialogOpen(),true,"failed Open stays in dialog");
});

test("P382 normal Tab and Shift+Tab wrap enabled visible controls and never enter editable Main",()=>{
  const v=harness();v.open();
  const primary=v.overlay.querySelector(".vaultDialogPrimary");
  const cancel=v.overlay.querySelector(".vaultDialogSecondary");
  assert.strictEqual(v.doc.activeElement,primary);
  const back=v.dispatch("Tab",{shiftKey:true});
  assert.equal(back.defaultPrevented,true);
  assert.strictEqual(v.doc.activeElement,cancel);
  const forward=v.dispatch("Tab");
  assert.equal(forward.defaultPrevented,true);
  assert.strictEqual(v.doc.activeElement,primary);
  v.tree.focus();
  assert.strictEqual(v.doc.activeElement,v.tree);
  const recovered=v.dispatch("Tab");
  assert.equal(recovered.defaultPrevented,true);
  assert.strictEqual(v.doc.activeElement,primary);
  assert.equal(v.actualUi.isDialogOpen(),true);
  assert.equal(v.counters.mainFocus,1,"external focus simulated, but Tab restores the dialog owner");
});

test("P382 queued window-focus callback cannot steal tree focus after dialog opens",()=>{
  const v=harness();
  v.installDeferredFocus();
  v.windowFocus();
  assert.equal(v.queuedFrames,1);
  v.open();
  assert.equal(v.queuedFrames,2);
  v.flushFrame();
  assert.equal(v.counters.mainFocus,0,"queued pre-dialog callback must recheck owner");
  v.flushFrame();
  assert.ok(v.card.contains(v.doc.activeElement));
  v.windowFocus();
  assert.equal(v.queuedFrames,0,"focus should not even schedule while visible");
  v.dispatch("Escape");
  v.windowFocus();
  assert.equal(v.queuedFrames,1);
  v.flushFrame();
  assert.strictEqual(v.doc.activeElement,v.tree);
  assert.equal(v.counters.mainFocus,1);
});

test("P382 actual prior file-picker, recovery and device-decision focus guards still precede Main",()=>{
  const v=harness();
  let filePicker=true,recovery=false,device=false;
  v.c.PocketNativeFilePickerActivity={isActive(){return filePicker;}};
  v.c.isPocketVaultRecoveryFlowOpen=()=>recovery;
  v.c.isPocketDeviceChangesDecisionOpen=()=>device;
  v.installDeferredFocus();
  v.windowFocus();assert.equal(v.queuedFrames,0);
  filePicker=false;recovery=true;
  v.windowFocus();assert.equal(v.queuedFrames,0);
  v.dispatch("s",{ctrlKey:true});assert.equal(v.counters.save,0);
  recovery=false;device=true;
  v.windowFocus();assert.equal(v.queuedFrames,0);
  v.dispatch("s",{ctrlKey:true});assert.equal(v.counters.save,0);
  device=false;
  v.dispatch("s",{ctrlKey:true});assert.equal(v.counters.save,1);
});

test("P382 Main yields without preventDefault for ordinary browser shortcuts while Sync dialog owns focus",()=>{
  const v=harness();
  v.open();
  for(const name of ["ArrowDown","ArrowUp","Delete","Enter","c","f","s","z","/","?"]){
    const e=v.dispatch(name,{ctrlKey:["c","f","s","z"].includes(name)});
    assert.equal(e.defaultPrevented,false,name);
  }
  assert.equal(v.counters.save,0);
  assert.equal(v.counters.undo,0);
  assert.equal(v.counters.palette,0);
  assert.equal(v.counters.help,0);
});

test("P382 no document, Save, transport or progressive feature authority added by dialog guards",()=>{
  const overlay=read("js/pocket-overlays-init.js"),ui=read("js/pocket-sync-ui.js");
  assert.match(overlay,/window\.PocketSyncUi\?\.isDialogOpen\?\.\(\) === true/);
  assert.match(ui,/isDialogOpen: \(\) => installedDialogOpen\(\) === true/);
  assert.doesNotMatch(ui,/setInterval|setTimeout|MutationObserver/);
  assert.match(read("js/pocket-sync-production-bootstrap.js"),
    /PocketSyncBrowserIntegration\?\.create\?\.\(\)/);
  assert.doesNotMatch(read("sync-service/pocket-sync-production-server.js"),
    /pocket-progressive-open-connection\.js|pocket-progressive-open-presentation-connection\.js/);
});
