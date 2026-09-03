from pathlib import Path
import runpy

ROOT = Path('.')
expected = "js/pocket-sync-remote-client.js: expected one match for '    async function compareAndSetShadowHead"
try:
    runpy.run_path('.github/p168-server.py', run_name='__main__')
except SystemExit as error:
    if expected not in str(error):
        raise

path = ROOT / 'js/pocket-sync-remote-client.js'
text = path.read_text()
old = '''    async function compareAndSetShadowHead(input) {
      const value=validateObjectHeadRequest(input,["apiVersion","operationId","syncedPocketId","expectedHead","candidateSealStorageRef"]), request=frozen({apiVersion:1,operationId:identifier(value.operationId),syncedPocketId:identifier(value.syncedPocketId),expectedHead:validateShadowHead(value.expectedHead),candidateSealStorageRef:validateObjectRef(value.candidateSealStorageRef)}), result=validateTransportResult(await callTransport(remote,"compareAndSetShadowHead",request),[200,409]);
      if (result.status===409 && result.body?.reason==="service-persistence-authority-transition-active") { const body=exactObject(result.body,["apiVersion","ok","reason"],["apiVersion","ok","reason"]); if (body.apiVersion!==1 || body.ok!==false || body.reason!=="service-persistence-authority-transition-active") throw remoteError("remote-response-invalid"); return frozen({apiVersion:1,ok:false,operationId:request.operationId,syncedPocketId:request.syncedPocketId,reason:"authority-transition-active"}); } if (result.status===409) { const body=exactObject(result.body,["apiVersion","ok","operationId","syncedPocketId","reason"],["apiVersion","ok","operationId","syncedPocketId","reason"]); if (body.apiVersion!==1 || body.ok!==false || body.operationId!==request.operationId || body.syncedPocketId!==request.syncedPocketId || !["head-conflict","candidate-object-missing","head-revision-exhausted"].includes(body.reason)) throw remoteError("remote-response-invalid"); return frozen(body); }
      const body=exactObject(result.body,["apiVersion","ok","operationId","syncedPocketId","head"],["apiVersion","ok","operationId","syncedPocketId","head"]), head=validateShadowHead(body.head,"remote-response-invalid"); if (body.apiVersion!==1 || body.ok!==true || body.operationId!==request.operationId || body.syncedPocketId!==request.syncedPocketId || head.revision!==request.expectedHead.revision+1 || head.sealRef!==request.candidateSealStorageRef) throw remoteError("remote-response-invalid"); return frozen({...body,head});
    }
'''
new = '''    async function compareAndSetShadowHead(input) {
      const legacyFields=["apiVersion","operationId","syncedPocketId","expectedHead","candidateSealStorageRef"], authoritative=!!input && typeof input==="object" && Object.prototype.hasOwnProperty.call(input,"expectedAuthorityRevision"), fields=authoritative?[...legacyFields,"expectedAuthorityRevision"]:legacyFields;
      const value=validateObjectHeadRequest(input,fields), request=frozen({apiVersion:1,operationId:identifier(value.operationId),syncedPocketId:identifier(value.syncedPocketId),expectedHead:validateShadowHead(value.expectedHead),candidateSealStorageRef:validateObjectRef(value.candidateSealStorageRef),...(authoritative?{expectedAuthorityRevision:revision(value.expectedAuthorityRevision,1)}:{})}), result=validateTransportResult(await callTransport(remote,"compareAndSetShadowHead",request),[200,409]);
      if (result.status===409 && result.body?.reason==="service-persistence-authority-transition-active") { const body=exactObject(result.body,["apiVersion","ok","reason"],["apiVersion","ok","reason"]); if (body.apiVersion!==1 || body.ok!==false || body.reason!=="service-persistence-authority-transition-active") throw remoteError("remote-response-invalid"); return frozen({apiVersion:1,ok:false,operationId:request.operationId,syncedPocketId:request.syncedPocketId,reason:"authority-transition-active"}); }
      if (result.status===409 && result.body?.reason==="authority-conflict") { const body=exactObject(result.body,["apiVersion","ok","operationId","syncedPocketId","status","reason","authority"],["apiVersion","ok","operationId","syncedPocketId","status","reason","authority"]); if (body.apiVersion!==1 || body.ok!==false || body.operationId!==request.operationId || body.syncedPocketId!==request.syncedPocketId || body.status!=="conflict" || body.reason!=="authority-conflict") throw remoteError("remote-response-invalid"); return frozen({...body,authority:validatePersistenceAuthorityState(body.authority)}); }
      if (result.status===409) { const body=exactObject(result.body,["apiVersion","ok","operationId","syncedPocketId","reason","head"],["apiVersion","ok","operationId","syncedPocketId","reason"]); if (body.apiVersion!==1 || body.ok!==false || body.operationId!==request.operationId || body.syncedPocketId!==request.syncedPocketId || !["head-conflict","candidate-object-missing","head-revision-exhausted"].includes(body.reason)) throw remoteError("remote-response-invalid"); return frozen(body); }
      const body=exactObject(result.body,["apiVersion","ok","operationId","syncedPocketId","head"],["apiVersion","ok","operationId","syncedPocketId","head"]), head=validateShadowHead(body.head,"remote-response-invalid"); if (body.apiVersion!==1 || body.ok!==true || body.operationId!==request.operationId || body.syncedPocketId!==request.syncedPocketId || head.revision!==request.expectedHead.revision+1 || head.sealRef!==request.candidateSealStorageRef) throw remoteError("remote-response-invalid"); return frozen({...body,head});
    }
'''
if text.count(old) != 1:
    raise SystemExit(f'remote CAS exact block count {text.count(old)}')
path.write_text(text.replace(old,new,1))

path = ROOT / 'js/pocket-starling-durable-publication.js'
text = path.read_text()
old = '''    async function attemptHead(descriptorInput) {
      const descriptor = await provePresence(descriptorInput, "pre-cas");
      let response;
      try {
        response = await service.compareAndSetShadowHead({
          apiVersion: API_VERSION,
          operationId: freshOperationId("durable-compare-and-set-head", 0),
          syncedPocketId: descriptor.syncedPocketId,
          expectedHead: descriptor.expectedHead,
          candidateSealStorageRef: descriptor.candidateSealStorageRef,
        });
'''
new = '''    async function attemptHead(descriptorInput, expectedAuthorityRevision = null) {
      const descriptor = await provePresence(descriptorInput, "pre-cas");
      if (expectedAuthorityRevision !== null
          && (!Number.isSafeInteger(expectedAuthorityRevision) || expectedAuthorityRevision < 1)) {
        throw fail("authority-revision-invalid");
      }
      let response;
      try {
        response = await service.compareAndSetShadowHead({
          apiVersion: API_VERSION,
          operationId: freshOperationId("durable-compare-and-set-head", 0),
          syncedPocketId: descriptor.syncedPocketId,
          expectedHead: descriptor.expectedHead,
          candidateSealStorageRef: descriptor.candidateSealStorageRef,
          ...(expectedAuthorityRevision === null ? {} : { expectedAuthorityRevision }),
        });
'''
if text.count(old) != 1:
    raise SystemExit(f'durable attempt exact block count {text.count(old)}')
text = text.replace(old,new,1)
old = '''      if (response?.ok === false && response.reason === "head-conflict") {
        return Object.freeze({ outcome: "conflict" });
      }
'''
new = '''      if (response?.ok === false && ["head-conflict", "authority-conflict"].includes(response.reason)) {
        return Object.freeze({ outcome: "conflict", reason: response.reason });
      }
'''
if text.count(old) != 1:
    raise SystemExit(f'durable conflict block count {text.count(old)}')
path.write_text(text.replace(old,new,1))
print('P168 server/transport patch + matcher repair applied')
