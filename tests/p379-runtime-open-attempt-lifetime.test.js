"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
const source = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const plain = v => JSON.parse(JSON.stringify(v));

function accepted(file, exports, patches = []) {
  const filename = path.join(__dirname, file);
  let s = fs.readFileSync(filename, "utf8");
  const marker = 'const test = require("node:test");';
  assert.ok(s.includes(marker), file);
  s = s.replace(marker, "const test = () => {};");
  for (const [a,b] of patches) {
    assert.equal(s.split(a).length, 2, "accepted fixture seam: " + a.slice(0, 70));
    s = s.replace(a,b);
  }
  const m = { exports: {} };
  new Function("require","module","exports","__filename","__dirname",
    s + "\nmodule.exports = { " + exports.join(",") + " };\n")(
      require,m,m.exports,filename,__dirname);
  return m.exports;
}
const { rig } = accepted("p375-starling-scoped-open-handoff.test.js",["rig"]);
function gate() {
  let release;
  return {promise:new Promise(resolve => {release=resolve;}), release:()=>release()};
}
function realStarlingRuntime(r, factory, options={}) {
  const c = r.c;
  for (const file of [
    "js/pocket-sync-security-contract.js","js/pocket-sync-device-store.js",
    "js/pocket-sync-account-client.js","js/pocket-sync-activation.js",
    "js/pocket-sync-emergency-recovery.js","js/pocket-sync-owner-controller.js",
    "js/pocket-owner-save-boundary.js","js/pocket-sync-activation-owner-bridge.js",
    "js/pocket-progressive-open-state.js","js/pocket-progressive-open-connection.js",
    "js/pocket-sync-browser-runtime.js",
  ]) vm.runInContext(source(file), c, {filename:file});
  const store=r.config.deviceStore;
  c.PocketSyncDeviceStore = Object.freeze({
    ...c.PocketSyncDeviceStore,createIndexedDbDriver(){return {};},createStore(){return store;}
  });
  let authCalls=0,ownerAdoptions=0,commits=0,saveInstalled=0;
  const realAccount=r.config.accountClient;
  c.PocketSyncAccountClient=Object.freeze({
    ...c.PocketSyncAccountClient,
    createBrowserWebAuthnAdapter(){return {createCredential(){}};},
    createClient(){return {async authenticatePasskey(...args){
      authCalls++;
      if(options.beforeAuthentication) await options.beforeAuthentication();
      return realAccount.authenticatePasskey(...args);
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
      async adoptSyncedOwner(){ownerAdoptions++;return {ok:true};},
      releaseSyncedOwner(){}
    };}
  });
  c.PocketOwnerSaveBoundary=Object.freeze({
    hasSyncedOwner(){return false;},
    installSyncedOwnerForSave(){saveInstalled++;return true;}
  });
  let targetId="original";
  c.capturePocketFileSaveSession=()=>({ownerKind:"detached",id:targetId});
  c.hasPocketUnsavedChanges=()=>options.dirty===true;
  c.PocketNodePopoutWindow={hasUnsavedChanges(){return false;}};
  c.hasUnsavedDetailsEditorChanges=()=>false;
  c.hasUnsavedInlineTitleDraft=()=>false;
  c.isPocketPayloadShape=p=>p?.schema==="portal.export.v1";
  c.normaliseInput=p=>p;
  c.commitPreparedPocketDocument=(payload,_meta,opts)=>{
    assert.equal(opts.canContinue(),true);
    assert.equal(payload.schema,"portal.export.v1");
    commits++;return {ok:true};
  };
  const runtime=c.PocketSyncBrowserRuntime.createRuntime({
    accountService:{beginRegistration(){},finishRegistration(){},
      beginAuthentication(){},finishAuthentication(){}},
    discoveryService:r.config.discoveryService,
    contentService:{...r.config.contentService,async conditionalUpload(){
      throw Error("unexpected content write");}},
    envelopeService:r.config.envelopeService,
    recoveryService:{initialiseRecovery(){}},
    persistenceAuthorityService:r.config.persistenceAuthorityService,
    objectHeadService:r.config.objectHeadService,
    environment:{crypto:webcrypto,indexedDB:{},now:()=>0},
    ...(factory?{progressiveOpenObserverFactory:factory}:{})
  });
  return {c,runtime,setTarget:id=>{targetId=id;},
    get authCalls(){return authCalls;},get ownerAdoptions(){return ownerAdoptions;},
    get commits(){return commits;},get saveInstalled(){return saveInstalled;}};
}

// Only the in-memory P052 TEST transport/owner wrappers are augmented with
// deterministic gates. Real browser runtime, real service and real adopter run.
const rawTransport = 'const bTransport = transportFor(() => bSessionId, (value) => { bSessionId = value; });';
const gatedTransport = [
 'const originalBTransport = transportFor(() => bSessionId, (value) => { bSessionId = value; });',
 'const bTransport = options.beforeBRequest',
 '  ? Object.freeze({ async request(route, body) {',
 '      await options.beforeBRequest(route, body);',
 '      return originalBTransport.request(route, body);',
 '    } }) : originalBTransport;'
].join("\n  ");
const rawRuntime = 'const runtime = b.PocketSyncBrowserRuntime.createRuntime({';
const gatedRuntime = [
 'if (options.beforeAdoptSyncedOwner) {',
 '  const factory = b.PocketSyncOwnerController.createSyncedOwnerController;',
 '  b.PocketSyncOwnerController = Object.freeze({',
 '    ...b.PocketSyncOwnerController,',
 '    createSyncedOwnerController(input) {',
 '      const real = factory(input);',
 '      return Object.freeze({ ...real, async adoptSyncedOwner(request) {',
 '        await options.beforeAdoptSyncedOwner(request);',
 '        return real.adoptSyncedOwner(request);',
 '      }});',
 '    }',
 '  });',
 '}',
 'const runtime = b.PocketSyncBrowserRuntime.createRuntime({'
].join("\n  ");
const rawConfig = 'discoveryService: bRemote.createPocketDiscoveryService({ transport: bTransport }), environment,';
const gatedConfig = rawConfig+'\n    ...(options.observerFactory ? {progressiveOpenObserverFactory:options.observerFactory} : {}),';
const {createBrowserJourney} = accepted("p052-additional-device.test.js",
 ["createBrowserJourney"],[
  [rawTransport,gatedTransport],[rawRuntime,gatedRuntime],[rawConfig,gatedConfig]
 ]);
const routeCount=(j,name)=>j.remoteCalls.filter(x=>x.route===name).length;

test("P379 actual runtime -> actual additional-device -> authentic P124/P368/P375 -> P376 root -> complete adoption",async()=>{
  const r=await rig();let factories=0,handoffs=0,retirements=0,guard,session;
  const h=realStarlingRuntime(r,({isAttemptCurrent})=>{
    factories++;guard=isAttemptCurrent;
    session=r.c.PocketProgressiveOpenConnection.createSession({isAttemptCurrent});
    return Object.freeze({
      async onScopedStarlingReader(reader,source,isCurrent){
        handoffs++;
        assert.equal(r.materialized,0);
        assert.strictEqual(r.readerInputs[0],r.sessions[0]);
        assert.equal(reader.ok,true);
        assert.equal(reader.scope,"incomplete");
        assert.equal(reader.acceptedSealRef,source.acceptedSealRef);
        assert.equal(isCurrent(),true);
        assert.equal(guard(),true);
        await session.onScopedStarlingReader(reader,source,isCurrent);
        assert.deepEqual(plain(session.inspect("root").childIds),["parent","sibling"]);
        assert.equal(session.inspect("parent").childrenState,"unresolved");
        assert.equal(session.inspect("deep"),null);
        assert.strictEqual(r.mainState.nodes,r.mainTruth.nodesRef);
        assert.equal(r.materialized,0);
      },
      retire(){retirements++;session.retire();}
    });
  });
  const result=await h.runtime.openExisting();
  assert.deepEqual(plain(result),{ok:true,reason:"synced-pocket-opened",confirmedRemoteRevision:1});
  assert.equal(factories,1);
  assert.equal(handoffs,1);
  assert.equal(r.readerBuilds,1);
  assert.equal(r.materialized,1);
  assert.equal(h.commits,1);
  assert.equal(h.ownerAdoptions,1);
  assert.equal(h.saveInstalled,1);
  assert.equal(retirements,1);
  assert.equal(guard(),false);
  assert.equal(session.currentSource(),null);
  assert.equal(r.writes.store,0);
  assert.equal(r.remoteCalls.some(([route])=>["putOpaqueObject","compareAndSetShadowHead"].includes(route)),false);
  assert.deepEqual(Object.keys(h.runtime).sort(),[
    "activate","admitAcceptedDeleteRestore","continueOwnerlessFirstCreate",
    "findRecoveryAttempt","openExisting","recoverExisting","restartLegacyRecovery",
    "resume","resumeRecovery","startOwnerlessFirstCreate"
  ]);
  console.log("P379_REAL_RUNTIME "+JSON.stringify({
    factories,handoffs,root:["parent","sibling"],materialisations:1,
    commits:h.commits,ownerAdoptions:h.ownerAdoptions,retirements,guardAfter:guard()
  }));
});

test("P379 real same-target runtime Open B BUSY while A held in authentication; A retains its lease",async()=>{
  const r=await rig(),entered=gate(),release=gate();let first=true,retired=0,guards=[];
  const h=realStarlingRuntime(r,({isAttemptCurrent})=>{
    guards.push(isAttemptCurrent);
    return {async onScopedStarlingReader(){throw Error("fixture observer rejects");},
      retire(){retired++;}};
  },{async beforeAuthentication(){
    if(first){first=false;entered.release();await release.promise;}
  }});
  const a=h.runtime.openExisting();await entered.promise;
  assert.equal(h.authCalls,1);
  assert.equal(guards.length,1);
  const b=await h.runtime.openExisting();
  assert.equal(b.reason,"additional-device-open-busy");
  assert.equal(h.authCalls,1);
  assert.equal(guards.length,1);
  assert.equal(retired,0);
  assert.equal(guards[0](),true);
  release.release();assert.equal((await a).ok,false);
  assert.equal(retired,1);
  assert.equal(guards[0](),false);
  const later=await h.runtime.openExisting();
  assert.notEqual(later.reason,"additional-device-open-busy");
  assert.equal(h.authCalls,2);
  assert.equal(retired,2);
  assert.equal(h.commits,0);
});

test("P379 genuine new-device ENROLMENT window keeps competing runtime Open B completely outside",async()=>{
  const entered=gate(),release=gate();let first=true;
  const j=await createBrowserJourney({skipOpenExisting:true,
    async beforeBRequest(route){
      if(route==="addEnvelope"&&first){
        first=false;entered.release();await release.promise;
      }
    }});
  const a=j.runtime.openExisting();await entered.promise;
  const auth=routeCount(j,"beginAuthentication"),writes=j.idb.writes.length;
  const grants=routeCount(j,"addEnvelope");
  assert.ok(auth>0);assert.equal(grants,0);
  const b=await j.runtime.openExisting();
  assert.equal(b.reason,"additional-device-open-busy");
  assert.equal(routeCount(j,"beginAuthentication"),auth);
  assert.equal(routeCount(j,"addEnvelope"),grants);
  assert.equal(j.idb.writes.length,writes);
  release.release();
  const opened=await a;assert.equal(opened.ok,true,JSON.stringify(opened));
  assert.equal(routeCount(j,"addEnvelope"),1);
  assert.equal(j.ownerKind,"synced");
  assert.notEqual((await j.runtime.openExisting()).reason,"additional-device-open-busy");
  console.log("P379_ENROLMENT "+JSON.stringify({busy:b.reason,authenticationDelta:0,
    enrolmentDelta:0,originalGrants:routeCount(j,"addEnvelope"),finalOwner:j.ownerKind}));
});

test("P379 real final owner-adoption awaited window holds one runtime flight until success",async()=>{
  const entered=gate(),release=gate();let first=true;
  const j=await createBrowserJourney({sameDeviceReopen:true,skipOpenExisting:true,
    async beforeAdoptSyncedOwner(){
      if(first){first=false;entered.release();await release.promise;}
    }});
  const a=j.runtime.openExisting();await entered.promise;
  const auth=routeCount(j,"beginAuthentication"),commits=j.commits;
  assert.ok(commits>0);
  const b=await j.runtime.openExisting();
  assert.equal(b.reason,"additional-device-open-busy");
  assert.equal(routeCount(j,"beginAuthentication"),auth);
  assert.equal(j.commits,commits);
  release.release();assert.equal((await a).ok,true);
  assert.equal(j.ownerKind,"synced");
  assert.notEqual((await j.runtime.openExisting()).reason,"additional-device-open-busy");
  console.log("P379_ADOPTION "+JSON.stringify({busy:b.reason,authenticationDelta:0,
    commitDelta:0,finalOwner:j.ownerKind}));
});

test("P379 actual adopter partialState is preserved and private observer retires",async()=>{
  let factories=0,retirements=0,observations=0,guard;
  const j=await createBrowserJourney({sameDeviceReopen:true,skipOpenExisting:true,
    ownerAdoptionFailsAfterCommit:true,
    observerFactory({isAttemptCurrent}){
      factories++;guard=isAttemptCurrent;
      return {async onScopedStarlingReader(){observations++;},
        retire(){retirements++;}};
    }});
  const result=await j.runtime.openExisting();
  assert.equal(result.ok,false);
  assert.equal(result.reason,"owner-adoption-failed");
  assert.equal(result.partialState,"visible-payload-committed-detached");
  assert.equal(factories,1);
  assert.equal(observations,0,"whole-record does not invent structural callback");
  assert.equal(retirements,1);
  assert.equal(guard(),false);
  assert.notEqual((await j.runtime.openExisting()).reason,"additional-device-open-busy");
});

test("P379 no observer: genuine completed-device and new-device Opens retain original results",async()=>{
  for(const opts of [{sameDeviceReopen:true},{sameDeviceReopen:false}]){
    const j=await createBrowserJourney({...opts,skipOpenExisting:true});
    assert.deepEqual(plain(await j.runtime.openExisting()),{
      ok:true,reason:"synced-pocket-opened",confirmedRemoteRevision:1});
    assert.equal(j.ownerKind,"synced");
  }
  assert.doesNotMatch(source("js/pocket-sync-local-integration.js"),/progressiveOpenObserverFactory/);
  assert.doesNotMatch(source("sync-service/pocket-sync-production-server.js"),
    /pocket-progressive-open-connection\.js|pocket-progressive-open-presentation-connection\.js/);
});

test("P379 P124 Starling no-observer pathway stays complete without new P368 read",async()=>{
  const r=await rig(),h=realStarlingRuntime(r,null);
  assert.equal((await h.runtime.openExisting()).ok,true);
  assert.equal(r.readerBuilds,0);
  assert.equal(r.materialized,1);
  assert.equal(h.commits,1);
  assert.equal(h.ownerAdoptions,1);
});

test("P379 invalid and throwing observer factories fail without authentication, release flight",async()=>{
  for(const mode of ["invalid","throwing","retire-throws"]){
    const r=await rig();let called=0,retired=0;
    const h=realStarlingRuntime(r,()=>{
      called++;
      if(mode==="throwing")throw Error("factory rejected");
      if(mode==="invalid")return {};
      return {async onScopedStarlingReader(){throw Error("observer rejected");},
        retire(){retired++;throw Error("retire threw");}};
    });
    assert.equal((await h.runtime.openExisting()).ok,false);
    assert.equal(called,1);
    assert.equal(h.commits,0);
    assert.equal(h.ownerAdoptions,0);
    assert.equal(r.materialized,0);
    assert.equal(retired,mode==="retire-throws"?1:0);
    assert.notEqual((await h.runtime.openExisting()).reason,"additional-device-open-busy");
    assert.equal(called,2);
  }
});

test("P379 stale ORIGINAL target after awaited authentication denies callback/adoption and retires",async()=>{
  const r=await rig(),entered=gate(),release=gate();
  let called=0,retired=0,guard;
  const h=realStarlingRuntime(r,({isAttemptCurrent})=>{
    guard=isAttemptCurrent;
    return {async onScopedStarlingReader(){called++;},retire(){retired++;}};
  },{async beforeAuthentication(){entered.release();await release.promise;}});
  const a=h.runtime.openExisting();await entered.promise;
  h.setTarget("changed");assert.equal(guard(),false);
  release.release();assert.equal((await a).ok,false);
  assert.equal(called,0);
  assert.equal(h.commits,0);
  assert.equal(h.ownerAdoptions,0);
  assert.equal(retired,1);
  assert.notEqual((await h.runtime.openExisting()).reason,"additional-device-open-busy");
});

test("P379 invalid input does not acquire flight or instantiate observer",async()=>{
  const r=await rig();let calls=0;
  const h=realStarlingRuntime(r,()=>{calls++;return {onScopedStarlingReader(){},retire(){}};});
  assert.equal((await h.runtime.openExisting({notAllowed:true})).ok,false);
  assert.equal(calls,0);
  assert.equal((await h.runtime.openExisting()).ok,true);
  assert.equal(calls,1);
});
