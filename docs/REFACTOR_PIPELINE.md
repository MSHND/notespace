# Pocket refactor pipeline

Use this before behaviour changes.

1. Name the behaviour.
2. Pick the canonical owner.
3. List old plumbing being replaced.
4. Write the manual test first.
5. Change narrowly.
6. Verify by reading the changed file back.
7. Run the manual test.
8. Remove replaced wrappers only after the new owner passes.

Rule: no new wrapper unless there is no safer option.
