from pathlib import Path
import runpy

runpy.run_path('.github/p168-server3.py', run_name='__main__')

# Preserve the pre-P168 Head conflict response shape exactly; authority conflicts use the dedicated wrapper.
path = Path('sync-service/pocket-sync-service-core.js')
text = path.read_text()
old = '''      return frozen({ status: result.ok ? 200 : 409, body: { apiVersion: 1,
        ok: result.ok === true, operationId: request.operationId,
        syncedPocketId: request.syncedPocketId, ...(result.ok ? { head: result.head }
          : { reason: result.reason, head: result.head ?? null }) }, session: null });
'''
new = '''      return frozen({ status: result.ok ? 200 : 409, body: { apiVersion: 1,
        ok: result.ok === true, operationId: request.operationId,
        syncedPocketId: request.syncedPocketId, ...result }, session: null });
'''
if text.count(old) != 1:
    raise SystemExit(f'core Head response patch count {text.count(old)}')
path.write_text(text.replace(old,new,1))

# Exact public-contract tests now include the purpose-specific P168 route/method.
path = Path('tests/p032-sync-remote-client.test.js')
text = path.read_text()
old = '''    readPersistenceAuthority: "/pockets/authority/read",
    acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",
    releasePersistenceAuthorityFence: "/pockets/authority/fence/release",
'''
new = '''    readPersistenceAuthority: "/pockets/authority/read",
    acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",
    commitStarlingAuthorityAdoption: "/pockets/authority/starling/adopt",
    releasePersistenceAuthorityFence: "/pockets/authority/fence/release",
'''
if text.count(old) != 1:
    raise SystemExit(f'p032 route expectation count {text.count(old)}')
text = text.replace(old,new,1)
old = '''    ["read", "acquireFence", "releaseFence"]
'''
new = '''    ["read", "acquireFence", "commitStarlingAdoption", "releaseFence"]
'''
if text.count(old) != 1:
    raise SystemExit(f'p032 authority method expectation count {text.count(old)}')
path.write_text(text.replace(old,new,1))

path = Path('tests/p034-sync-service-core.test.js')
text = path.read_text()
old = '''    "readPersistenceAuthority",
    "acquirePersistenceAuthorityFence",
    "releasePersistenceAuthorityFence",
'''
new = '''    "readPersistenceAuthority",
    "acquirePersistenceAuthorityFence",
    "commitStarlingAuthorityAdoption",
    "releasePersistenceAuthorityFence",
'''
if text.count(old) != 1:
    raise SystemExit(f'p034 core method expectation count {text.count(old)}')
path.write_text(text.replace(old,new,1))
print('P168 exact surface expectations patched')
