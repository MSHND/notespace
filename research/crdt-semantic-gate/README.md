# Pocket CRDT semantic research gate

Disposable three-way comparison, **not a production Pocket edit**.

Real Yjs 13.6.33 and Automerge 3.5.0 are exercised with the same base content and editing intentions. The third comparator is an intentionally SMALL **research-only** Pocket-style semantic admission reference, not a claim to run the current production Thought Engine.

Coverage: disjoint edits, competing replacements, same-position insertion, stable reference target and nested idea IDs, selection/cursor persistence across editing and save/reopen, Yjs local Undo versus an **explicit inverse semantic edit** in Automerge, atomic conflict holds and permission separation. Results are classified for architectural reasoning, NOT as proof either engine independently honours Pocket policy.

The test log captures concrete CRDT outcomes for overlapping human edits. Convergence means replicas agree; it does NOT prove agreement with human intent. Metrics measure one-node edit+incremental encoding in flat 128/1024/2048-record fixtures and are one-off illustrative measurements, NOT representative benchmarks for actual Pocket or safe grounds for a speed ranking.

Unproven: real input method editors, native caret/focus, privacy scope compilation, sharing permissions, production encryption, device enrolment, full two-device Sync, semantic command coupling, scalability to a large encrypted Pocket.

Do not adopt code, edit main, deploy, interpret the reference model as Pocket production implementation or choose a final engine from this alone. The GitHub workflow runs on candidate/crdt-semantic-proof-20261017 with read-only permissions and retains exact source/test evidence.
