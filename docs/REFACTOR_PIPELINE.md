# Pocket refactor pipeline

Every behaviour change should move through this pipeline before code changes.

## 1. Name the behaviour

Describe the behaviour being changed in plain language.

## 2. Pick the canonical owner

Choose the one file or module that should own this behaviour.

## 3. Identify replaced plumbing

List old wrappers, fallbacks, or scripts that the new owner will replace.

## 4. Define the test

Write the manual test before changing code.

## 5. Change narrowly

