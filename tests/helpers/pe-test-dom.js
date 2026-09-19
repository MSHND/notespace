"use strict";

function createPeTestDom(options = {}) {
  let documentRef = null;

  function notify(name, ...args) {
    const fn = options[name];
    if (typeof fn === "function") fn(...args);
  }

  function classTokens(node) {
    return String(node && node.className || "").split(/\s+/).filter(Boolean);
  }

  function matchesSelector(node, selector) {
    if (!node || node.nodeType !== 1) return false;
    const id = node.getAttribute?.("data-line-id");
    const classes = classTokens(node);
    if (selector === ".lineText[data-line-id]") return classes.includes("lineText") && !!id;
    if (selector === ".lineGutter[data-line-id]") return classes.includes("lineGutter") && !!id;
    if (selector === ".docRow[data-line-id]") return classes.includes("docRow") && !!id;
    return false;
  }

  class TextNode {
    constructor(value = "") {
      this.nodeType = 3;
      this.nodeValue = String(value);
      this.parentNode = null;
    }
    get textContent() { return this.nodeValue; }
    set textContent(value) { this.nodeValue = String(value); }
    contains(candidate) { return candidate === this; }
  }

  class Element {
    constructor(tagName = "div") {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this.style = {};
      this.attributes = new Map();
      this.children = [];
      this.childNodes = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      this.readOnly = false;
      this.contentEditable = "false";
      this.spellcheck = false;
      this.draggable = false;
      const classState = new Set();
      this.classList = {
        toggle: (name, force) => {
          const token = String(name);
          const next = force === undefined ? !classState.has(token) : !!force;
          if (next) classState.add(token); else classState.delete(token);
          notify("onClassToggle", token, next, this);
          return next;
        },
        add: (...names) => { for (const name of names) classState.add(String(name)); },
        remove: (...names) => { for (const name of names) classState.delete(String(name)); },
        contains: (name) => classState.has(String(name)),
      };
    }

    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }

    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }

    dispatch(type, values = {}) {
      const event = {
        type,
        target: this,
        key: "",
        keyCode: 0,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
        ...values,
      };
      for (const handler of this.listeners.get(type) || []) {
        handler(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    }

    appendChild(child) {
      if (!child) throw new TypeError("appendChild requires a node");
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      if (child.nodeType === 1) this.children.push(child);
      return child;
    }

    insertBefore(child, before) {
      if (!child) throw new TypeError("insertBefore requires a node");
      if (before === child && child.parentNode === this) return child;
      if (before != null && before.parentNode !== this) throw new Error("NotFoundError");
      if (child.parentNode) child.parentNode.removeChild(child);
      const nodeIndex = before == null ? this.childNodes.length : this.childNodes.indexOf(before);
      if (nodeIndex < 0) throw new Error("NotFoundError");
      const elementIndex = before == null
        ? this.children.length
        : this.children.indexOf(before);
      child.parentNode = this;
      this.childNodes.splice(nodeIndex, 0, child);
      if (child.nodeType === 1) {
        this.children.splice(elementIndex >= 0 ? elementIndex : this.children.length, 0, child);
      }
      return child;
    }

    removeChild(child) {
      const nodeIndex = this.childNodes.indexOf(child);
      if (nodeIndex < 0) throw new Error("NotFoundError");
      this.childNodes.splice(nodeIndex, 1);
      const elementIndex = this.children.indexOf(child);
      if (elementIndex >= 0) this.children.splice(elementIndex, 1);
      child.parentNode = null;
      return child;
    }

    contains(candidate) {
      return candidate === this || this.childNodes.some((child) => child.contains?.(candidate));
    }

    closest(selector) {
      let candidate = this;
      while (candidate) {
        if (matchesSelector(candidate, selector)) return candidate;
        candidate = candidate.parentNode;
      }
      return null;
    }

    querySelectorAll(selector) {
      const result = [];
      const visit = (candidate) => {
        for (const child of candidate.childNodes || []) {
          if (child.nodeType !== 1) continue;
          if (matchesSelector(child, selector)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    focus() {
      if (documentRef) documentRef.activeElement = this;
    }

    select() {}
  }

  Object.defineProperty(Element.prototype, "textContent", {
    get() { return this.childNodes.map((child) => child.textContent || "").join(""); },
    set(value) {
      for (const child of this.childNodes) child.parentNode = null;
      this.children.length = 0;
      this.childNodes.length = 0;
      const next = String(value == null ? "" : value);
      if (next.length) this.appendChild(new TextNode(next));
    },
  });

  Object.defineProperty(Element.prototype, "innerHTML", {
    get() { return ""; },
    set() {
      notify("onInnerHTMLClear", this);
      for (const child of this.childNodes) child.parentNode = null;
      this.children.length = 0;
      this.childNodes.length = 0;
    },
  });

  Object.defineProperty(Element.prototype, "firstChild", {
    get() { return this.childNodes[0] || null; },
  });
  Object.defineProperty(Element.prototype, "lastChild", {
    get() { return this.childNodes.length ? this.childNodes[this.childNodes.length - 1] : null; },
  });
  Object.defineProperty(Element.prototype, "previousSibling", {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes || [];
      const index = siblings.indexOf(this);
      return index > 0 ? siblings[index - 1] : null;
    },
  });
  Object.defineProperty(Element.prototype, "nextSibling", {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes || [];
      const index = siblings.indexOf(this);
      return index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;
    },
  });

  function textLength(node) {
    return String(node && node.textContent || "").length;
  }

  function absoluteOffset(root, container, offset) {
    let total = 0;
    let found = false;
    const visit = (node) => {
      if (!node || found) return;
      if (node === container) {
        if (node.nodeType === 3) {
          total += Math.max(0, Math.min(Number(offset) || 0, textLength(node)));
        } else {
          const limit = Math.max(0, Math.min(Number(offset) || 0, (node.childNodes || []).length));
          for (let index = 0; index < limit; index += 1) total += textLength(node.childNodes[index]);
        }
        found = true;
        return;
      }
      if (node.nodeType === 3) {
        total += textLength(node);
        return;
      }
      for (const child of node.childNodes || []) visit(child);
    };
    visit(root);
    return found ? total : null;
  }

  function pointForOffset(root, offset) {
    let remaining = Math.max(0, Math.min(Number(offset) || 0, textLength(root)));
    let lastText = null;
    const visit = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) {
          lastText = child;
          const length = textLength(child);
          if (remaining <= length) return { container: child, offset: remaining };
          remaining -= length;
          continue;
        }
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    const point = visit(root);
    if (point) return point;
    if (lastText) return { container: lastText, offset: textLength(lastText) };
    return { container: root, offset: 0 };
  }

  class Range {
    constructor() {
      this.startContainer = null;
      this.endContainer = null;
      this.startOffset = 0;
      this.endOffset = 0;
      this.collapsed = true;
      this.selectedRoot = null;
      this.selectedTarget = null;
      this.collapsedToStart = null;
    }

    cloneRange() {
      const clone = new Range();
      clone.startContainer = this.startContainer;
      clone.endContainer = this.endContainer;
      clone.startOffset = this.startOffset;
      clone.endOffset = this.endOffset;
      clone.collapsed = this.collapsed;
      clone.selectedRoot = this.selectedRoot;
      clone.selectedTarget = this.selectedTarget;
      clone.collapsedToStart = this.collapsedToStart;
      return clone;
    }

    selectNodeContents(target) {
      this.selectedRoot = target;
      this.selectedTarget = target;
      this.startContainer = target;
      this.startOffset = 0;
      this.endContainer = target;
      this.endOffset = (target.childNodes || []).length;
      this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }

    setStart(container, offset) {
      this.startContainer = container;
      this.startOffset = Number(offset) || 0;
      this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }

    setEnd(container, offset) {
      this.endContainer = container;
      this.endOffset = Number(offset) || 0;
      this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }

    collapse(toStart) {
      this.collapsedToStart = toStart === true;
      if (toStart) {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      } else {
        this.startContainer = this.endContainer;
        this.startOffset = this.endOffset;
      }
      this.collapsed = true;
    }

    toString() {
      if (!this.selectedRoot) return "";
      const text = String(this.selectedRoot.textContent || "");
      const start = absoluteOffset(this.selectedRoot, this.startContainer, this.startOffset);
      const end = absoluteOffset(this.selectedRoot, this.endContainer, this.endOffset);
      if (start === null || end === null) return "";
      return text.slice(Math.min(start, end), Math.max(start, end));
    }

    getBoundingClientRect() {
      if (typeof options.rangeRect === "function") {
        const rect = options.rangeRect(this, { absoluteOffset, pointForOffset, textLength });
        if (rect) return rect;
      }
      return { top: 0, bottom: 0, height: 0 };
    }

    getClientRects() {
      const rect = this.getBoundingClientRect();
      return rect && Number(rect.height) > 0 ? [rect] : [];
    }
  }

  let ranges = [];
  const selection = {
    get rangeCount() { return ranges.length; },
    getRangeAt(index) { return ranges[index]; },
    removeAllRanges() { ranges = []; },
    addRange(range) { ranges = [range]; },
  };

  return {
    Element,
    TextNode,
    Range,
    selection,
    textLength,
    absoluteOffset,
    pointForOffset,
    bindDocument(document) { documentRef = document; },
    resetSelection() { ranges = []; },
  };
}

module.exports = { createPeTestDom };
