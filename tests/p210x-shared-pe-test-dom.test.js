"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }

test("P210x product runtime is byte-identical to frozen P210w-final", () => {
  const bytes = fs.readFileSync(path.join(ROOT, "js/pocket-node-popout-runtime.js"));
  const prefix = Buffer.from(`blob ${bytes.length}\0`);
  const gitBlobSha = crypto.createHash("sha1").update(prefix).update(bytes).digest("hex");
  assert.equal(gitBlobSha, "b1034fa1c57c52d2aac9af430dcac7127cee1422");
});

test("P210x migrated PE suites share one DOM mutation owner", () => {
  const suites = [
    "tests/p207-pe-empty-line-backspace.test.js",
    "tests/p207a-pe-collapsed-focus.test.js",
    "tests/p207e-pe-caret-after-empty-backspace.test.js",
    "tests/p209-pe-vertical-caret-travel.test.js",
    "tests/p210v-pe-local-projection.test.js",
  ];
  for (const suite of suites) {
    const text = source(suite);
    assert.match(text, /require\("\.\/helpers\/pe-test-dom"\)/, suite);
    assert.doesNotMatch(text, /appendChild\s*\(child\)\s*\{/, suite);
    assert.doesNotMatch(text, /insertBefore\s*\(child/, suite);
    assert.doesNotMatch(text, /removeChild\s*\(child/, suite);
    assert.doesNotMatch(text, /Object\.defineProperty\(Element\.prototype,\s*"previousSibling"/, suite);
    assert.doesNotMatch(text, /Object\.defineProperty\(Element\.prototype,\s*"nextSibling"/, suite);
  }
});

test("P210x shared PE DOM authority owns browser-standard node movement and sibling semantics", () => {
  const { createPeTestDom } = require("./helpers/pe-test-dom");
  const dom = createPeTestDom();
  const { Element } = dom;
  const document = { activeElement: null };
  dom.bindDocument(document);

  const parent = new Element("div");
  const other = new Element("div");
  const a = new Element("div");
  const b = new Element("div");
  const c = new Element("div");
  parent.appendChild(a);
  parent.appendChild(b);
  parent.appendChild(c);

  assert.equal(parent.firstChild, a);
  assert.equal(parent.lastChild, c);
  assert.equal(a.nextSibling, b);
  assert.equal(c.previousSibling, b);

  parent.insertBefore(c, a);
  assert.deepEqual(parent.children, [c, a, b]);
  assert.equal(parent.children.filter((node) => node === c).length, 1);

  other.appendChild(a);
  assert.deepEqual(parent.children, [c, b]);
  assert.deepEqual(other.children, [a]);
  assert.equal(a.parentNode, other);

  parent.removeChild(b);
  assert.deepEqual(parent.children, [c]);
  assert.equal(b.parentNode, null);

  c.focus();
  assert.equal(document.activeElement, c);
});
