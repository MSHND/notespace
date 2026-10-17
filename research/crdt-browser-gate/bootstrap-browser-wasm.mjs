import fs from 'node:fs';
const appPath = 'app.mjs', testPath = 'tests/browser-gate.test.mjs';
let app = fs.readFileSync(appPath, 'utf8');
const exact = (s, before, after) => {
  if (s.split(before).length !== 2) throw new Error('WASM adapter expected exactly one '+before.slice(0,45));
  return s.replace(before, after);
};
app = exact(app,
  "import * as A from '@automerge/automerge';",
  "import * as A from '@automerge/automerge/slim';\nimport { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';"
);
app = exact(app, '\ninitial();\n', '\nif (engine === \'automerge\') {\n  A.initializeBase64Wasm(automergeWasmBase64).then(() => { initial(); render({forceBody:true}); }).catch(error => console.error(\'Automerge browser bootstrap failed\', error));\n} else initial();\n');
const ending='\nrender({forceBody:true});\n';
if (!app.endsWith(ending)) throw new Error('Unexpected app end');
app = app.slice(0,-ending.length) + "\nif (engine === 'yjs') render({forceBody:true});\n";
fs.writeFileSync(appPath,app);
let tests=fs.readFileSync(testPath,'utf8');
tests=exact(tests,'await page.waitForFunction(() => Boolean(window.pocketResearch));','await page.waitForFunction(() => Boolean(window.pocketResearch) && document.querySelector("#body").value.length > 0);');
const invalidCDPFields=',replacementStart:-1,replacementEnd:-1';
if (tests.split(invalidCDPFields).length !== 3) throw new Error('Unexpected Chromium CDP fixture');
tests=tests.replaceAll(invalidCDPFields,'');
fs.writeFileSync(testPath,tests);
console.log('DISPOSABLE_AUTOMERGE_WASM_ADAPTER_APPLIED');
