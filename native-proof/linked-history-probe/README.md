# Pocket linked semantic history — disposable proof

Candidate-only experiment. No production Pocket, no accepted model revision, no real data, no Sync, no deployment.

Goal: exercise one linked typed change record model for a text word edit, a structural move with attached descendant, a JSON snapshot/readback Save boundary, and reverse changes after Save. A reversal creates a new linked record instead of deleting saved history. Revision and epoch guards reject stale Save. The same records project as full local JSON and separately as a bounded incremental change JSON feed for a possible future encrypted Sync adapter.

Run: bash native-proof/linked-history-probe/check-linked-history.sh

Deliberate limits: four nodes, 24 records, 128-byte node text, no sibling order, no real .pocket schema or JSON import, no crash-safe storage, no real encrypted Sync, no actual Undo/Redo UI, no human-scale grouping, no cross-device concurrency, no runtime integration and no Stage 0 acceptance. The test uses disposable tmpfile write/readback and semantic admission; that is NOT a production file Save. See Pocket Interaction & Change Model North Star for the motivating transaction design.