from pathlib import Path


def patch(path, old, new, label, count=1):
    p = Path(path)
    text = p.read_text()
    found = text.count(old)
    if found != count:
        raise SystemExit(f"{label}: expected {count} occurrence(s), got {found}")
    p.write_text(text.replace(old, new, count))

# Only ask crypto for semantic authority when the paired P168 authority services
# are actually present. Legacy injected callers retain their exact call shape.
patch('js/pocket-sync-additional-device.js',
'''      bundle = await config.crypto.openMasterKeyBundle(record.deviceEnvelope.record,
        record.deviceWrappingKey, record.deviceEnvelope.context, [], { semanticAuthority: true });
''',
'''      bundle = config.persistenceAuthorityService
        ? await config.crypto.openMasterKeyBundle(record.deviceEnvelope.record,
          record.deviceWrappingKey, record.deviceEnvelope.context, [], { semanticAuthority: true })
        : await config.crypto.openMasterKeyBundle(record.deviceEnvelope.record,
          record.deviceWrappingKey, record.deviceEnvelope.context, []);
''', 'existing bundle compatibility')

patch('js/pocket-sync-additional-device.js',
'''        opened = await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
          wrappingKey, context, [], { semanticAuthority: true });
''',
'''        opened = config.persistenceAuthorityService
          ? await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
            wrappingKey, context, [], { semanticAuthority: true })
          : await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
            wrappingKey, context, []);
''', 'initial bundle compatibility')

patch('js/pocket-sync-additional-device.js',
'''      const durableBundle = await config.crypto.openMasterKeyBundle(
        finalRecord.deviceEnvelope.record,
        finalRecord.deviceWrappingKey,
        finalRecord.deviceEnvelope.context,
        [],
        { semanticAuthority: true }
      );
''',
'''      const durableBundle = config.persistenceAuthorityService
        ? await config.crypto.openMasterKeyBundle(
          finalRecord.deviceEnvelope.record,
          finalRecord.deviceWrappingKey,
          finalRecord.deviceEnvelope.context,
          [],
          { semanticAuthority: true }
        )
        : await config.crypto.openMasterKeyBundle(
          finalRecord.deviceEnvelope.record,
          finalRecord.deviceWrappingKey,
          finalRecord.deviceEnvelope.context,
          []
        );
''', 'durable bundle compatibility')

# Local integration composes authority services when production exposes them,
# but old provider-neutral injected test clients remain valid.
patch('js/pocket-sync-local-integration.js',
'''        || typeof remote.createContentService !== "function"
        || typeof remote.createPersistenceAuthorityService !== "function"
        || typeof remote.createObjectHeadService !== "function"
        || typeof remote.createEnvelopeService !== "function"
''',
'''        || typeof remote.createContentService !== "function"
        || typeof remote.createEnvelopeService !== "function"
''', 'local optional foundation')

patch('js/pocket-sync-local-integration.js',
'''    const contentService = remote.createContentService({ transport });
    const runtime = browser.createRuntime({
''',
'''    const contentService = remote.createContentService({ transport });
    const authorityServices = typeof remote.createPersistenceAuthorityService === "function"
      && typeof remote.createObjectHeadService === "function"
      ? { persistenceAuthorityService: remote.createPersistenceAuthorityService({ transport }),
        objectHeadService: remote.createObjectHeadService({ transport }) }
      : {};
    const runtime = browser.createRuntime({
''', 'local authority pair construction')

patch('js/pocket-sync-local-integration.js',
'''      contentService,
      persistenceAuthorityService: remote.createPersistenceAuthorityService({ transport }),
      objectHeadService: remote.createObjectHeadService({ transport }),
      envelopeService: remote.createEnvelopeService({ transport }),
''',
'''      contentService,
      ...authorityServices,
      envelopeService: remote.createEnvelopeService({ transport }),
''', 'local optional authority composition')

patch('js/pocket-sync-local-integration.js',
'''        const authorityOperation = operationId();
        if (!authorityOperation) return safeFailure("round-trip-unavailable");
        const authority = await remote.createPersistenceAuthorityService({ transport }).read({
          apiVersion: 1, operationId: authorityOperation, syncedPocketId,
        });
        if (authority?.authority?.currentMode === "starling") {
          return safeFailure("round-trip-starling-authority");
        }
        if (authority?.authority?.currentMode !== "whole-record"
            || authority.authority.transition !== null) return safeFailure("round-trip-not-ready");
        const savedPayload = currentPayload();
''',
'''        if (typeof remote.createPersistenceAuthorityService === "function") {
          const authorityOperation = operationId();
          if (!authorityOperation) return safeFailure("round-trip-unavailable");
          const authority = await remote.createPersistenceAuthorityService({ transport }).read({
            apiVersion: 1, operationId: authorityOperation, syncedPocketId,
          });
          if (authority?.authority?.currentMode === "starling") {
            return safeFailure("round-trip-starling-authority");
          }
          if (authority?.authority?.currentMode !== "whole-record"
              || authority.authority.transition !== null) return safeFailure("round-trip-not-ready");
        }
        const savedPayload = currentPayload();
''', 'roundtrip optional authority')

# The P041/P045/P051a/P052 harnesses predate accepted P166's mandatory server
# objectHeadStore. Bring only these directly affected fixtures up to accepted
# main's factory contract so they can genuinely exercise P168.
helper = '''
function p168ObjectHeadStore() {
  let head = { schema: "pocket.starling.head.v1", revision: 0, sealRef: null };
  return Object.freeze({
    async putObject() { return { ok: true, created: true }; },
    async getObject() { return null; },
    async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: false })); },
    async initialiseHead() { return head; },
    async readHead() { return head; },
    async compareAndSetHead(_pocket, expected, candidate) {
      if (head.revision !== expected.revision || head.sealRef !== expected.sealRef) {
        return { ok: false, reason: "head-conflict", head };
      }
      head = { schema: head.schema, revision: head.revision + 1, sealRef: candidate };
      return { ok: true, head };
    },
  });
}
'''
for path in [
    'tests/p041-emergency-recovery.test.js',
    'tests/p045-browser-sync-runtime.test.js',
    'tests/p051a-local-sync-acceptance.test.js',
    'tests/p052-additional-device.test.js',
]:
    p = Path(path)
    text = p.read_text()
    if 'function p168ObjectHeadStore()' not in text:
        marker = 'const ROOT = path.resolve(__dirname, "..");\n'
        if marker not in text:
            raise SystemExit(f'{path}: ROOT marker missing')
        text = text.replace(marker, marker + helper + '\n', 1)
    # Only calls that still lack objectHeadStore are amended.
    text = text.replace('    store: serviceDriver.store,\n    webAuthnVerifier:',
      '    store: serviceDriver.store,\n    objectHeadStore: p168ObjectHeadStore(),\n    webAuthnVerifier:')
    text = text.replace('    store: driver.store,\n    webAuthnVerifier:',
      '    store: driver.store,\n    objectHeadStore: p168ObjectHeadStore(),\n    webAuthnVerifier:')
    p.write_text(text)

print('P168 legacy compatibility and affected fixture repairs applied')
