"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname,".."), source = p => fs.readFileSync(path.join(ROOT,p),"utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function accepted(file,exports) {
  const filename=path.join(__dirname,file);
  const content=fs.readFileSync(filename,"utf8");
  const declaration='const test = require("node:test");';
  assert.ok(content.includes(declaration),file+" fixture contract");
  const module={exports:{}};
  new Function("require","module","exports","__filename","__dirname",
    content.replace(declaration,"const test = () => {};")
    + "\nmodule.exports = {"+exports.join(",")+"};\n")(
      require,module,module.exports,filename,__dirname);
  return module.exports;
}
const {rig}=accepted("p375-starling-scoped-open-handoff.test.js",["rig"]);
function gate(){let release;return {promise:new Promise(r=>{release=r;}),release:()=>release()};}
async function settled(v){await v.done.promise;await Promise.resolve();await Promise.resolve();await Promise.resolve();}

function makeDom(c,{noHost=false}={}) {
  let doc;
  const removed=[];
  class Element {
    constructor(tag="div"){
      this.tagName=String(tag).toUpperCase();this.id="";this.className="";
      this.childNodes=[];this.parentNode=null;this.ownerDocument=doc;
      this.hidden=false;this.disabled=false;this.textContent="";
      this.dataset={};this.tabIndex=-1;this.listeners=new Map();
      this.attributes=new Map();this.value="";this.style={};
      this.classList={
        contains:n=>this.className.split(/\s+/).includes(n),
        add:n=>{this.className+=" "+n;},
        remove:n=>{this.className=this.className.split(/\s+/).filter(x=>x!==n).join(" ");}
      };
    }
    appendChild(v){if(v.parentNode)v.parentNode.removeChild(v);
      this.childNodes.push(v);v.parentNode=this;return v;}
    insertBefore(v,ref){if(v.parentNode)v.parentNode.removeChild(v);
      const i=this.childNodes.indexOf(ref);if(i<0)throw Error("NotFoundError");
      this.childNodes.splice(i,0,v);v.parentNode=this;return v;}
    removeChild(v){const i=this.childNodes.indexOf(v);if(i<0)throw Error("NotFoundError");
      if(this.className==="vaultDialogIncomingTree"&&v.className==="treeNode")removed.push(v);
      this.childNodes.splice(i,1);v.parentNode=null;return v;}
    remove(){if(this.parentNode)this.parentNode.removeChild(this);}
    get firstChild(){return this.childNodes[0]||null;}
    get children(){return this.childNodes;}
    setAttribute(n,v){this.attributes.set(n,String(v));if(n==="id")this.id=String(v);}
    getAttribute(n){return this.attributes.get(n)??null;}
    removeAttribute(n){this.attributes.delete(n);}
    contains(v){return v===this||this.childNodes.some(child=>child.contains(v));}
    querySelector(sel) {
      const match=v=>sel[0]==="#"?v.id===sel.slice(1)
        :sel[0]==="."?v.className.split(/\s+/).includes(sel.slice(1))
        :v.tagName.toLowerCase()===sel.toLowerCase();
      const find=root=>{for(const child of root.childNodes){
        if(match(child))return child;const nested=find(child);if(nested)return nested;
      }return null;};return find(this);
    }
    addEventListener(n,f){const l=this.listeners.get(n)||[];l.push(f);this.listeners.set(n,l);}
    fire(n,more={}){for(const f of this.listeners.get(n)||[])f({
      key:"",target:this,preventDefault(){},stopPropagation(){},...more
    });}
    focus(){doc.activeElement=this;}
    set innerHTML(html){
      for(const child of this.childNodes)child.parentNode=null;
      this.childNodes.length=0;
      if(!String(html).includes('class="vaultDialogCard"'))return;
      const add=(parent,tag,type,value)=>{
        const e=doc.createElement(tag);
        e[type]=value;parent.appendChild(e);return e;
      };
      const card=add(this,"section","className","vaultDialogCard");
      if(noHost)card.insertBefore=null;
      const header=add(card,"header","className","vaultDialogHeader");
      add(header,"h2","id","syncSetupTitle");
      add(header,"p","id","syncSetupBody");
      add(card,"p","id","syncSetupStatus");
      add(card,"pre","id","syncOpenDiagnostic");
      const actions=add(card,"div","className","vaultDialogActions");
      for(const name of ["vaultDialogPrimary","vaultDialogCreateAccount",
        "vaultDialogRecovery","vaultDialogChooseAccount","vaultDialogRestart",
        "vaultDialogSecondary"]){
        const button=add(actions,"button","className",name);
        if(name==="vaultDialogChooseAccount")button.hidden=true;
      }
    }
  }
  class Button extends Element{constructor(){super("button");}}
  doc={
    activeElement:null,currentScript:{dataset:{serviceRoot:"/sync"}},
    createElement(tag){return String(tag).toLowerCase()==="button"?new Button():new Element(tag);},
    body:null,getElementById(id){return this.body.querySelector("#"+id);},
    listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);}
  };
  doc.body=new Element("body");
  const buttons={};
  for(const [key,id] of [["command","cmdSync"],["topbar","btnOpenSynced"],["more","btnMore"]]){
    buttons[key]=new Button();buttons[key].id=id;doc.body.appendChild(buttons[key]);
  }
  buttons.command.appendChild(new Element("span"));
  const hint=new Element("span");hint.className="commandHint";buttons.command.appendChild(hint);
  const sourceLabel=new Element("span");sourceLabel.id="activeDocumentSource";doc.body.appendChild(sourceLabel);
  const mainWrap=new Element("div");mainWrap.id="treeWrap";
  const main=new Element("ul");main.id="treeRoot";mainWrap.appendChild(main);
  doc.body.appendChild(mainWrap);
  const oldRow=new Element("li");oldRow.textContent="Existing editable document";main.appendChild(oldRow);
  c.document=doc;c.HTMLElement=Element;c.HTMLButtonElement=Button;
  c.HTMLInputElement=class Input extends Element{};
  c.requestAnimationFrame=fn=>{fn?.();return 1;};
  c.closeCommandPalette=()=>false;
  c.isPocketVaultRecoveryFlowOpen=()=>false;
  c.isPocketFilePermissionPromptOpen=()=>false;
  c.isPocketDeviceChangesDecisionOpen=()=>false;
  c.PocketVaultBrowserIo={isDialogOpen(){return false;}};
  c.addEventListener=()=>{};
  return {doc,buttons,main,oldRow,removed,
    overlay:()=>doc.body.querySelector(".vaultDialogOverlay"),
    preview:()=>doc.body.querySelector(".vaultDialogIncomingPreview"),
    mount:()=>doc.body.querySelector(".vaultDialogIncomingTree")};
}

async function composition({preview=true,failMaterialisation=false,noHost=false,
  missing=null,newDevice=false,partialAdoption=false,failSecondRoot=false}={}) {
  const r=await rig(),c=r.c;
  if(newDevice) {
    let local=null;const writes={local:0,envelopes:0};
    r.config.deviceStore={
      async open(){},async readPocket(){return local;},
      async createPocket(record){writes.local++;local=record;},
      async replacePocket(_id,_rev,record){writes.local++;local=record;},
      async reservePocketEncryptionUsage(){throw Error("unexpected reservation");}
    };
    r.config.accountClient={async authenticatePasskey(){
      return {ok:true,accountAuthenticated:true,contentUnlocked:false,
        accountId:"account-p375",credentialId:"credential-p375",
        prf:{status:"available",outputBytes:new Uint8Array(32)}};
    }};
    const meta={envelopeId:"prf-p375",envelopeKind:"passkey-prf",
      envelopeVersion:1,deviceId:null,credentialId:"credential-p375",
      kdf:"HKDF-SHA-256",kdfSalt:"salt-p375",derivationVersion:1};
    r.config.envelopeService={
      async listEnvelopes(){return {keySetVersion:1,envelopes:[{...meta,status:"active"}]};},
      async downloadEnvelope(){return {keySetVersion:1,
        envelope:{...meta,encryptedEnvelope:{fixture:"protected"}}};},
      async addEnvelope(){writes.envelopes++;return {status:"committed",keySetVersion:2,
        masterKeyGeneration:1,masterKeyContentEncryptionLimit:2**20};}
    };
    const realCrypto=c.PocketSyncCrypto;
    c.PocketSyncCrypto=Object.freeze({...realCrypto,
      async deriveWrappingKey(){return r.bundle.wrappingKey;},
      async openMasterKeyBundle(_record,_key,_context,recipients=[]){
        return {masterKey:r.stage.key,semanticAuthority:r.bundle.semanticAuthority,
          envelopes:recipients.map(()=>({record:r.bundle.record}))};
      }
    });
    r.testDeviceWrites=writes;
  }
  const dom=makeDom(c,{noHost});
  for(const file of ["js/pocket-render.js","js/pocket-sync-security-contract.js",
    "js/pocket-sync-device-store.js","js/pocket-sync-account-client.js",
    "js/pocket-sync-activation.js","js/pocket-sync-emergency-recovery.js",
    "js/pocket-sync-owner-controller.js","js/pocket-owner-save-boundary.js",
    "js/pocket-sync-activation-owner-bridge.js",
    "js/pocket-progressive-open-state.js","js/pocket-progressive-open-connection.js",
    "js/pocket-progressive-open-presentation-connection.js",
    "js/pocket-sync-browser-runtime.js","js/pocket-sync-ui.js"]){
    if(file!==missing)vm.runInContext(source(file),c,{filename:file});
  }
  let auth=0,commits=0,adoptions=0,saves=0,sessions=0,bridges=0;
  const createdBridges=[],createdSessions=[],store=r.config.deviceStore,account=r.config.accountClient;
  let target="original";
  c.PocketSyncDeviceStore=Object.freeze({
    ...c.PocketSyncDeviceStore,createIndexedDbDriver(){return {};},
    createStore(){return store;}
  });
  c.PocketSyncAccountClient=Object.freeze({
    ...c.PocketSyncAccountClient,
    createBrowserWebAuthnAdapter(){return {createCredential(){}};},
    createClient(){return {async authenticatePasskey(...args){
      auth++;return account.authenticatePasskey(...args);
    }};}
  });
  c.PocketSyncActivation=Object.freeze({
    createActivationOrchestrator(){return {};},
    createStrandedActivationClassifier(){return {classify(){return {status:"none"};}};}
  });
  c.PocketSyncEmergencyRecovery=Object.freeze({createRecoveryOrchestrator(){return {};}});
  c.PocketSyncActivationOwnerBridge=Object.freeze({createActivationOwnerBridge(){return {};}});
  c.PocketSyncOwnerController=Object.freeze({
    createSyncedOwnerController(){return {
      async canAdoptSyncedOwner(){return {ok:true};},
      async adoptSyncedOwner(){adoptions++;return {ok:true};},
      releaseSyncedOwner(){}
    };}
  });
  c.PocketOwnerSaveBoundary=Object.freeze({
    hasSyncedOwner(){return false;},
    installSyncedOwnerForSave(){saves++;return !partialAdoption;}
  });
  c.capturePocketFileSaveSession=()=>({ownerKind:"json",id:target});
  c.hasPocketUnsavedChanges=()=>false;
  c.PocketNodePopoutWindow={hasUnsavedChanges(){return false;}};
  c.hasUnsavedDetailsEditorChanges=()=>false;
  c.hasUnsavedInlineTitleDraft=()=>false;
  c.isPocketPayloadShape=p=>p?.schema==="portal.export.v1";
  c.normaliseInput=p=>p;
  c.commitPreparedPocketDocument=(payload,_meta,options)=>{
    assert.equal(options.canContinue(),true);assert.equal(payload.schema,"portal.export.v1");
    commits++;return {ok:true};
  };
  if(failSecondRoot&&c.PocketProgressiveOpenState){
    const actual=c.PocketProgressiveOpenState;
    let owners=0;
    c.PocketProgressiveOpenState=Object.freeze({...actual,
      createKnowledgeOwner(reader){
        owners++;
        if(owners===2){
          const failing=Object.freeze({...reader,
            async readChildren(parentId){
              return {ok:false,scope:"incomplete",parentId,reason:"controlled-second-root-failure"};
            }
          });
          return actual.createKnowledgeOwner(failing);
        }
        return actual.createKnowledgeOwner(reader);
      }
    });
  }
  if(c.PocketProgressiveOpenConnection){
    const real=c.PocketProgressiveOpenConnection;
    c.PocketProgressiveOpenConnection=Object.freeze({...real,
      createSession(args){sessions++;const session=real.createSession(args);
        createdSessions.push(session);return session;}
    });
  }
  if(c.PocketProgressiveOpenPresentationConnection){
    const real=c.PocketProgressiveOpenPresentationConnection;
    c.PocketProgressiveOpenPresentationConnection=Object.freeze({...real,
      createBridge(args){bridges++;const bridge=real.createBridge(args);
        createdBridges.push(bridge);return bridge;}
    });
  }
  c.PocketSyncRemoteClient=Object.freeze({
    createBrowserJsonTransport(){return {request(){throw Error("unexpected transport");}};},
    createAccountService(){return {beginRegistration(){},finishRegistration(){},
      beginAuthentication(){},finishAuthentication(){}};},
    createPocketDiscoveryService(){return r.config.discoveryService;},
    createContentService(){return {...r.config.contentService,
      async conditionalUpload(){throw Error("unexpected content write");}};},
    createEnvelopeService(){return r.config.envelopeService;},
    createRecoveryService(){return {initialiseRecovery(){}};},
    createPersistenceAuthorityService(){return r.config.persistenceAuthorityService;},
    createObjectHeadService(){return r.config.objectHeadService;}
  });
  const realMaterializer=c.PocketStarlingMaterializeShadow;
  const entered=gate(),release=gate();let materialisations=0,held=false;
  c.PocketStarlingMaterializeShadow=Object.freeze({...realMaterializer,
    async materializeAccepted(session){
      materialisations++;
      if((newDevice&&!failSecondRoot&&materialisations===2)
          ||((!newDevice||failSecondRoot)&&!held)){
        held=true;entered.release();await release.promise;
      }
      if(failMaterialisation)throw Error("controlled downstream failure");
      return realMaterializer.materializeAccepted(session);
    }
  });
  // Test instrumentation ONLY: let the real UI call the real integration.
  // Completion is observed at that call boundary, without sleeps/timers.
  const done=gate(),actualUi=c.PocketSyncUi;
  let registeredHost=null,lastOpenResult=null;
  c.PocketSyncUi=Object.freeze({...actualUi,install(integration){
    const observed=Object.freeze({...integration,
      ...(typeof integration.registerIncomingPreviewHost==="function"
        ? {registerIncomingPreviewHost(host){
            const accepted=integration.registerIncomingPreviewHost(host);
            if(accepted===true)registeredHost=host;
            return accepted;
          }} : {}),
      async openExisting(input){
      const result=await integration.openExisting(input);
      lastOpenResult=result;
      done.release();return result;
    }});
    return actualUi.install(observed);
  }});
  vm.runInContext(source("js/pocket-sync-local-integration.js"),c,
    {filename:"js/pocket-sync-local-integration.js"});
  const integration=preview
    ?c.PocketSyncLocalIntegration.create({progressivePreview:true})
    :c.PocketSyncLocalIntegration.create();
  const overlay=dom.overlay(),primary=overlay?.querySelector(".vaultDialogPrimary");
  assert.ok(overlay&&primary,"actual UI installed by actual local integration");
  return {r,c,dom,integration,entered,release,done,createdBridges,createdSessions,
    get registeredHost(){return registeredHost;},
    get lastOpenResult(){return lastOpenResult;},
    get auth(){return auth;},get commits(){return commits;},
    get adoptions(){return adoptions;},get saves(){return saves;},
    get sessions(){return sessions;},get bridges(){return bridges;},
    get materialisations(){return materialisations;},
    setTarget(value){target=value;},
    begin(){
      dom.buttons.topbar.fire("click");
      assert.equal(primary.dataset.mode,"open");
      primary.fire("click");
    },
    primary
  };
}
const rows=v=>v.dom.mount()?.childNodes.filter(x=>x.className==="treeNode")||[];
function visible(v){
  const pane=v.dom.preview(),mount=v.dom.mount();
  assert.ok(pane&&mount);
  assert.equal(pane.hidden,false);
  assert.equal(mount.getAttribute("data-pocket-scope"),"incomplete");
  const rendered=rows(v);
  assert.deepEqual(rendered.map(x=>x.firstChild.getAttribute("data-node-id")),["parent","sibling"]);
  for(const li of rendered){
    const row=li.firstChild;
    assert.equal(row.tabIndex,-1);
    assert.equal(row.getAttribute("aria-disabled"),"true");
    assert.equal(row.listeners.size,0);
    assert.equal(row.childNodes[1].getAttribute("data-children-state"),"unresolved");
    assert.equal(row.childNodes[1].textContent,"Children not loaded");
    assert.equal(li.childNodes[1].childNodes.length,0);
  }
  return rendered;
}
function cleared(v){
  assert.equal(v.dom.preview().hidden,true);
  assert.equal(v.dom.mount().childNodes.length,0);
}

test("P381 actual LocalIntegration + SyncUi + runtime + authenticated P375/P376 + real P377/P373 ROOT before adoption and cleanup",async()=>{
  const v=await composition();
  assert.equal(typeof v.integration.registerIncomingPreviewHost,"function");
  assert.equal(v.dom.preview().hidden,true);
  const original=v.r.mainState.nodes,json=JSON.stringify(original),oldRow=v.dom.oldRow;
  v.begin();await v.entered.promise;
  assert.equal(v.dom.overlay().hidden,false);
  assert.equal(v.primary.disabled,true);
  const first=visible(v);
  assert.strictEqual(v.r.mainState.nodes,original);
  assert.equal(JSON.stringify(v.r.mainState.nodes),json);
  assert.strictEqual(v.dom.main.firstChild,oldRow);
  assert.equal(v.r.materialized,0);
  assert.equal(v.commits,0);assert.equal(v.adoptions,0);assert.equal(v.saves,0);
  assert.equal(v.sessions,1);assert.equal(v.bridges,1);assert.equal(v.r.readerBuilds,1);
  const refused=await v.integration.openExisting();
  assert.equal(refused.reason,"additional-device-open-busy");
  assert.strictEqual(rows(v)[0],first[0]);
  v.release.release();await settled(v);
  assert.equal(v.commits,1);assert.equal(v.adoptions,1);assert.equal(v.saves,1);
  assert.equal(v.r.materialized,1);
  assert.equal(v.createdSessions[0].currentSource(),null,"P376 retired");
  assert.equal(v.createdBridges[0].refresh("root").ok,false,"P377 retired");
  cleared(v);
  assert.equal(v.dom.overlay().hidden,true);
  assert.equal(v.r.writes.store,0);
  assert.equal(v.r.remoteCalls.some(([route])=>
    ["putOpaqueObject","compareAndSetShadowHead"].includes(route)),false);
  console.log("P381_REAL_COMPOSITION "+JSON.stringify({
    root:["parent","sibling"],visibleBeforeMaterialisation:true,
    sessions:v.sessions,bridges:v.bridges,commits:v.commits,
    adoptions:v.adoptions,hiddenAfter:true
  }));
});

test("P381 failure after visible root retires observer and clears actual UI without adoption",async()=>{
  const v=await composition({failMaterialisation:true});
  v.begin();await v.entered.promise;visible(v);
  assert.equal(v.commits,0);
  v.release.release();await settled(v);
  cleared(v);assert.equal(v.commits,0);assert.equal(v.adoptions,0);
  assert.equal(v.createdSessions[0].currentSource(),null,"failed P376 retired");
  assert.equal(v.dom.overlay().hidden,false);
  assert.notEqual(v.dom.overlay().querySelector("#syncSetupStatus").textContent,"");
  assert.equal(v.r.writes.store,0);
});

test("P381 default production-shaped create() leaves UI without host and P375 hook absent",async()=>{
  const v=await composition({preview:false});
  assert.equal(Object.hasOwn(v.integration,"registerIncomingPreviewHost"),false);
  assert.equal(v.dom.preview(),null);
  v.begin();await v.entered.promise;
  assert.equal(v.r.readerBuilds,0);assert.equal(v.sessions,0);assert.equal(v.bridges,0);
  v.release.release();await settled(v);
  assert.equal(v.commits,1);assert.equal(v.adoptions,1);
  assert.equal(v.dom.preview(),null);
  assert.match(source("js/pocket-sync-production-bootstrap.js"),
    /PocketSyncBrowserIntegration\?\.create\?\.\(\)/);
  assert.doesNotMatch(source("index.html"),/pocket-progressive-open-connection\.js/);
  assert.doesNotMatch(source("sync-service/pocket-sync-production-server.js"),
    /pocket-progressive-open-connection\.js|pocket-progressive-open-presentation-connection\.js/);
});

test("P381 opted-in missing host refuses real runtime Open before authentication",async()=>{
  const v=await composition({noHost:true});
  assert.equal(v.dom.preview(),null);
  v.begin();await settled(v);
  assert.equal(v.auth,0);assert.equal(v.r.readerBuilds,0);
  assert.equal(v.commits,0);assert.equal(v.adoptions,0);
  assert.equal(v.dom.overlay().hidden,false);
});

test("P381 opted-in missing P376 or P377 fails before real authentication",async()=>{
  for(const missing of [
    "js/pocket-progressive-open-connection.js",
    "js/pocket-progressive-open-presentation-connection.js",
    "js/pocket-render.js"
  ]){
    const v=await composition({missing});v.begin();await settled(v);
    assert.equal(v.auth,0);assert.equal(v.r.readerBuilds,0);
    assert.equal(v.commits,0);assert.equal(v.adoptions,0);cleared(v);
  }
});

test("P381 new-device genuine TWO selections replace same-Seal projected generation, old presenter cannot repaint",async()=>{
  const v=await composition({newDevice:true});
  v.begin();await v.entered.promise;
  const second=visible(v);
  assert.equal(v.sessions,1);
  assert.equal(v.bridges,2);
  assert.equal(v.r.readerBuilds,2);
  assert.equal(v.r.sessions[0].acceptedSealRef,v.r.sessions[1].acceptedSealRef);
  assert.equal(v.dom.removed.length,2,"first selection DOM detached at second callback");
  assert.equal(v.dom.removed[0].parentNode,null);
  assert.notStrictEqual(second[0],v.dom.removed[0]);
  const before=rows(v).slice();
  assert.equal(v.createdBridges[0].refresh("root").ok,false,"old presenter retired");
  assert.strictEqual(rows(v)[0],before[0]);
  v.release.release();await settled(v);
  assert.equal(v.r.materialized,2);
  assert.equal(v.commits,1);assert.equal(v.adoptions,1);
  assert.equal(v.r.testDeviceWrites.envelopes,1);
  assert.equal(v.r.testDeviceWrites.local,2);
  cleared(v);
});



test("P381 partial final adoption preserves exact partialState while terminal preview disappears",async()=>{
  const v=await composition({partialAdoption:true});
  v.begin();await v.entered.promise;visible(v);
  v.release.release();await settled(v);
  assert.equal(v.lastOpenResult.ok,false);
  assert.equal(v.lastOpenResult.partialState,"visible-payload-committed-detached");
  assert.equal(v.commits,1);assert.equal(v.adoptions,1);assert.equal(v.saves,1);
  cleared(v);
  assert.equal(v.dom.overlay().hidden,false);
  assert.equal(v.createdSessions[0].currentSource(),null);
});

test("P381 failed SECOND genuine authenticated selection leaves first preview retired, never restored",async()=>{
  const v=await composition({newDevice:true,failSecondRoot:true});
  v.begin();await v.entered.promise;
  visible(v);
  assert.equal(v.bridges,1);
  v.release.release();await settled(v);
  assert.equal(v.r.readerBuilds,2,"both readers authenticated");
  assert.equal(v.sessions,1);
  assert.equal(v.bridges,1,"failed second root cannot attach a presenter");
  assert.equal(v.lastOpenResult.ok,false);
  assert.equal(v.commits,0);assert.equal(v.adoptions,0);
  assert.equal(v.createdSessions[0].currentSource(),null);
  cleared(v);
  assert.equal(v.dom.overlay().hidden,false);
});

test("P381 UI-owned host rejects stale visual generation reveal/clear without touching newer rows",async()=>{
  const v=await composition();
  const host=v.registeredHost;
  assert.ok(host&&host.mount===v.dom.mount());
  assert.equal(v.dom.preview().hidden,true);
  const a=host.begin();
  const b=host.begin();
  host.mount.appendChild(v.dom.doc.createElement("li"));
  assert.equal(host.reveal(a),false);
  assert.equal(host.clear(a),false);
  assert.equal(host.reveal(b),true);
  assert.equal(v.dom.preview().hidden,false);
  assert.equal(host.clear(a),false);
  assert.equal(v.dom.mount().childNodes.length,1);
  assert.equal(host.clear(b),true);
  cleared(v);
});

test("P381 opt-in rejects unknown/false values; production no-opt-in does not register host",async()=>{
  const v=await composition({preview:false});
  assert.throws(()=>v.c.PocketSyncLocalIntegration.create({progressivePreview:false}));
  assert.throws(()=>v.c.PocketSyncLocalIntegration.create({unknown:true}));
  assert.equal(v.dom.preview(),null);
});
