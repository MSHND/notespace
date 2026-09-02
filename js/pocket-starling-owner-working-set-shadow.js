/* Dormant P148 sequence-keyed owner working material. */
(function (global) {
  "use strict";

  function failure(code) {
    const error = new Error(`Pocket owner working set ${code}.`);
    error.code = code;
    return error;
  }

  function positiveSequence(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function nonNegativeSequence(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function plainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    return !!constructor
      && typeof constructor.value === "function"
      && Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object);
  }

  function jsonValue(value, stack) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || stack.has(value)) return false;
    if (Array.isArray(value)) {
      const names = Object.getOwnPropertyNames(value);
      if (Object.getOwnPropertySymbols(value).length !== 0 || names.length !== value.length + 1 || !names.includes("length")) return false;
      stack.add(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value") || !jsonValue(descriptor.value, stack)) {
          stack.delete(value);
          return false;
        }
      }
      stack.delete(value);
      return true;
    }
    if (!plainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) return false;
    stack.add(value);
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.enumerable !== true || !Object.prototype.hasOwnProperty.call(descriptor, "value") || !jsonValue(descriptor.value, stack)) {
        stack.delete(value);
        return false;
      }
    }
    stack.delete(value);
    return true;
  }

  function cloneJson(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneJson);
    const result = {};
    for (const name of Object.keys(value)) {
      Object.defineProperty(result, name, {
        value: cloneJson(value[name]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }

  function freezeDeep(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const name of Object.keys(value)) freezeDeep(value[name]);
      Object.freeze(value);
    }
    return value;
  }

  function ownedOperations(operations) {
    if (!Array.isArray(operations) || operations.length === 0) throw failure("owner-working-set-input-invalid");
    for (const operation of operations) {
      if (!plainObject(operation) || !jsonValue(operation, new Set())) throw failure("owner-working-set-input-invalid");
    }
    return freezeDeep(cloneJson(operations));
  }

  function createJournal() {
    const records = new Map();
    let settledFloor = 0;
    let invalidated = false;

    function requireUsable() {
      if (invalidated) throw failure("owner-working-set-invalidated");
    }

    function capture(sequence, operations) {
      requireUsable();
      if (!positiveSequence(sequence)) throw failure("owner-working-set-input-invalid");
      if (sequence <= settledFloor) throw failure("owner-working-set-sequence-settled");
      const owned = ownedOperations(operations);
      records.set(sequence, owned);
    }

    function discardUncovered(sequence, activeSaveOperationCeiling) {
      requireUsable();
      if (!positiveSequence(sequence) || !nonNegativeSequence(activeSaveOperationCeiling)) throw failure("owner-working-set-input-invalid");
      if (sequence <= activeSaveOperationCeiling || sequence <= settledFloor || !records.has(sequence)) return false;
      records.delete(sequence);
      return true;
    }

    function retainAfter(sequence) {
      requireUsable();
      if (!positiveSequence(sequence)) throw failure("owner-working-set-input-invalid");
      for (const key of records.keys()) {
        if (key <= sequence) records.delete(key);
      }
      settledFloor = Math.max(settledFloor, sequence);
      return records.size;
    }

    function freezeThrough(sequence) {
      requireUsable();
      if (!positiveSequence(sequence)) throw failure("owner-working-set-input-invalid");
      const operations = [];
      for (const key of Array.from(records.keys()).sort((left, right) => left - right)) {
        if (key > sequence || key <= settledFloor) continue;
        for (const operation of records.get(key)) operations.push(cloneJson(operation));
      }
      return freezeDeep({ ceiling: sequence, operations });
    }

    function reset() {
      requireUsable();
      records.clear();
      settledFloor = 0;
      return true;
    }

    function invalidate() {
      if (invalidated) return true;
      records.clear();
      settledFloor = 0;
      invalidated = true;
      return true;
    }

    return Object.freeze({ capture, discardUncovered, retainAfter, freezeThrough, reset, invalidate });
  }

  global.PocketStarlingOwnerWorkingSetShadow = Object.freeze({ createJournal });
})(typeof window !== "undefined" ? window : globalThis);
