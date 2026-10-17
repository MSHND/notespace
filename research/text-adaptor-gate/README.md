# Disposable Pocket text-engine adaptor proof

**Research only.** The test uses genuine Yjs 13.6.33 and Automerge 3.5.0 instances to produce bounded, immutable text proposals. The experiment does not change a production editor or define a final public API.

This test-only bridge can check exact node ID and initial text but has **no Save, Sync, permission, identity-adoption or publication authority**. It passes the resulting text through *Pocket's real canonical* `PocketNodePopoutEditor.apply` and then `exportTree` via the existing P360 harness. The CI job also runs the original production acceptance tests P360, P190b and P342 unchanged. Source revisions and a read-only workflow are verified.

Acceptance: engine edits alone cannot touch Pocket state or Head; canonical Pocket PE records one payload operation; explicit Save freezes the P160 journal and passes existing P172 semantic admission; stale node revision, wrong target, wrong source identity and invalid text remain fail-closed; unrelated node content and children survive.

**Limitations:** This is not actual native Pocket UI editing or a new semantic transaction feature. Testing a proposed text value through current PE does not prove full structural operations, fine-grained Undo, concurrent shared permission control, encryption, IME across operating systems, large-scale performance, or a final CRDT choice. A research adapter cannot authorise itself. Do not merge/adopt or deploy.
