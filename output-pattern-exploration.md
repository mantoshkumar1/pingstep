# Opt-in output-pattern stage detection: exploration

**Status:** P2 research only. This document does not authorize implementation or change the explicit-event MVP contract.

## Evidence and assumptions

**Evidence:** PingStep’s pilot scope is explicit `started`, `step`, `heartbeat`, `succeeded`, and `failed` events. Generic output-stage detection is an explicit MVP non-goal. No design partner has yet supplied a job-output sample or asked for output-derived stage detection.

**Assumptions to test later:** some qualifying scripts emit stable, non-sensitive progress lines; a job owner will opt in to sending those lines; and pattern configuration can produce useful stage labels with low false-positive risk.

## Decision

Do not implement output parsing before the pilot meets its primary validation threshold: three real-job integrations and two paid-pilot or switching commitments. Explicit events remain the only supported source of stage state.

## Narrow experiment, if the decision gate is met

Run one controlled experiment with one consenting partner and one job:

1. The partner supplies a redacted, representative sample of only the lines they approve for transmission.
2. The partner defines 2–4 literal or regular-expression patterns and the stage name each should emit.
3. Matching occurs only for that one job and only when a job-scoped `output_patterns_enabled` setting is true.
4. PingStep records the matched pattern ID and resulting stage label—not the raw output line—unless the partner separately agrees to short-lived diagnostic capture.
5. Compare detected stages to the partner’s expected stages across at least five real runs.

## Success and kill criteria

The experiment is worth extending only if all conditions hold:

- At least 90% of observed relevant stage changes match the partner’s expected stage.
- No raw secrets, customer data, or unapproved log content is stored or sent in alerts.
- The partner says it reduced setup work or answered a progress question that explicit events could not reasonably answer.
- Configuration takes less than 15 minutes and requires no PingStep staff interpretation of the job’s logs.

Stop the feature line if any partner must send raw logs to make it work, patterns are fragile across ordinary job changes, false positives erode trust, or it distracts from the primary paid-pilot validation target.

## Security and data boundary

- Default: disabled, per job, with explicit partner consent.
- Never accept unrestricted stdout/stderr streaming.
- Do not include matched text in the dashboard or webhook payloads.
- Store only a pattern ID, emitted stage name, timestamp, and run ID.
- Treat diagnostic snippets as exceptional, redacted, time-limited, and removable on request.

## Deferred implementation shape

If the experiment succeeds, introduce a separate ingestion adapter that turns one allowlisted pattern match into the existing explicit `step` event shape. It must not create a parallel run-state model, weaken event idempotency/order rules, or infer terminal success/failure from output.

## Evidence to collect before revisiting

| Evidence | Source | Required for decision |
| --- | --- | --- |
| Request for output-derived stages | Qualified design-partner interview | Yes |
| Approved redacted sample | Consenting partner | Yes |
| Expected stage mapping | Partner | Yes |
| Five-run accuracy record | Pilot observation | Yes |
| Effect on integration time or monitoring confidence | Post-run debrief | Yes |
