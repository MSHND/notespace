from pathlib import Path

path = Path('tests/p168-starling-reentry.test.js')
text = path.read_text()
old = '''    envelopeService: { async listEnvelopes() { return { keySetVersion: 2, envelopes: [{ status: "active",
      envelopeKind: "device", envelopeId: "envelope", envelopeVersion: 1, deviceId: "device",
      credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null }] }; } },
'''
new = '''    envelopeService: {
      async listEnvelopes() { return { keySetVersion: 2, envelopes: [{ status: "active",
        envelopeKind: "device", envelopeId: "envelope", envelopeVersion: 1, deviceId: "device",
        credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null }] }; },
      async downloadEnvelope() { throw new Error("unused"); },
      async addEnvelope() { throw new Error("unused"); },
    },
'''
if text.count(old) != 1:
    raise SystemExit('focused envelope fixture marker missing')
text = text.replace(old, new, 1)
text = text.replace(
  'assert.match(owner, /async function saveStarlingAuthority\\(payload, preparation, authority/);',
  'assert.match(owner, /async function savePreparedStarling\\(payload, preparation, authority, durable\\)/);',
  1)
path.write_text(text)
print('P168 focused proof fixtures repaired')
