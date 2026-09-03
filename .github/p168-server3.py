from pathlib import Path
import runpy

path = Path('.github/p168-server.py')
text = path.read_text()
old_pattern = "r'''  async function compareAndSetShadowHead\\(value\\) \\{.*?\\n  \\}\\n\\n  return Object\\.freeze\\(\\{''',"
new_pattern = "r'''  async function compareAndSetShadowHead\\(value\\) \\{.*?\\n  \\}\\n  async function completedReplay''',"
if text.count(old_pattern) != 1:
    raise SystemExit(f'core CAS regex marker count {text.count(old_pattern)}')
text = text.replace(old_pattern, new_pattern, 1)
old_tail = "  return Object.freeze({''')\n\n# Export the new exact authority operation."
new_tail = "  async function completedReplay''')\n\n# Export the new exact authority operation."
if text.count(old_tail) != 1:
    raise SystemExit(f'core CAS replacement tail count {text.count(old_tail)}')
path.write_text(text.replace(old_tail, new_tail, 1))
runpy.run_path('.github/p168-server2.py', run_name='__main__')
