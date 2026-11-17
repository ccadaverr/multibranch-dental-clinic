# Owner decisions received during Sprint10

2026-11-16 Asia/Manila, owner-mediated ChatGPT conversation. These decisions supersede the corresponding unresolved-policy notes in older reports. A policy approval is not implementation or acceptance evidence.

## DEN-14 / STF-21: conversation-specific clinical access

Authorized Staff may reassign an exact Patient/branch conversation to an active Dentist permitted at that branch, with a persistent, explicit conversation-specific clinical-access grant. Branch membership alone is insufficient. A matching In Treatment Visit is supporting evidence, never an automatic conversation grant; conversation authorization never authorizes chart, Visit, encounter or prescription changes.

Reassignment, activation and former-Dentist revocation must commit atomically with previous/new Dentist, conversation/Patient/branch, Staff actor, reason, timestamp and revision. Former Dentists lose ordinary access to all earlier and subsequent messages. Messages remain immutable; exceptional historical access requires separate explicit audited authority. Validate current access on every read/write, reject former-Dentist pending/replayed writes, invalidate stale views, and deny cross-Patient/branch access. Future Dentist notifications target only the newly authorized Dentist; old links and cached responses cannot expose revoked content. Existing Patient/authorized Staff recipient contracts remain.

If a secure persistent grant cannot be established, reassignment must fail closed. Any additional schema change requires separate review before execution. The owner subsequently approved **testing the proposed grant schema in a NEW disposable synthetic cluster only**. This is not approval to migrate the existing demo/test service, production, import Operations, publish or deploy.

Reviewed candidate: `integration/proposals/2026_11_16_001000_add_conversation_dentist_grants.php`. Append-only grants and a composite scope-checked active reference; no inferred legacy grants, no destructive automatic rollback. This proposal is intentionally outside automatic migration discovery. Test execution and application cutover must be reported separately.

## Queue ordering: Operations owner Joevan A

Eligible checked-in Patients use recorded arrival FIFO within the branch. Scheduled identity, classification and appointment time remain; scheduled appointments do not automatically overtake checked-in walk-ins. Existing permitted Staff reorder controls require exact identities, actor, time, reason and previous/new order. Preserve immutable arrival/reorder/status/treatment-start history. Equal timestamps require a documented stable identity tie-breaker. No cross-branch ordering/manipulation. `Served` is treatment START. No held migration or urgency conversion is authorized; admission/cancellation policies remain separate.

The scheduled-first string assertion is obsolete as a requirement. Its test must still check the substantive implemented ordering/history contract; changing that sentence alone cannot prove closure. Joevan A owns authoritative queue verification and any shared Operations correction. See the portable handoff below.
