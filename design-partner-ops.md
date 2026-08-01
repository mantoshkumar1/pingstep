# PingStep design-partner operations

**Purpose:** run the five-conversation / three-integration / two-commitment pilot from [the validation brief](./pilot-validation-brief.md) without collecting credentials, sensitive job payloads, or misleading ourselves with polite interest.

## Evidence and assumptions

**Evidence:** the service accepts explicit job events, records durable state, displays runs, and queues stale/late webhook alerts. The pilot thresholds and qualification screen are documented in the validation brief.

**Assumptions to test:** a qualifying engineer can safely connect a non-sensitive real job; the 10–15 minute event setup is acceptable; and the observed run yields enough value to support a paid-pilot or switching commitment.

There are currently **no recruited partners, conversations, integrations, or commitments**. Do not change those counts without a dated record below.

## Recruitment tracker

One row per person. Store personal contact details only in the outreach system used with their consent—not in this repository.

| Alias | Source/channel | Date contacted | Qualifies? | Real job type | Recent pain event | Interview date | Integration status | Commitment | Evidence link / note | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DP-01` |  |  |  |  |  |  |  |  |  |  |
| `DP-02` |  |  |  |  |  |  |  |  |  |  |
| `DP-03` |  |  |  |  |  |  |  |  |  |  |
| `DP-04` |  |  |  |  |  |  |  |  |  |  |
| `DP-05` |  |  |  |  |  |  |  |  |  |  |
| `DP-06` |  |  |  |  |  |  |  |  |  |  |
| `DP-07` |  |  |  |  |  |  |  |  |  |  |
| `DP-08` |  |  |  |  |  |  |  |  |  |  |

**Counting rules:**

- A **qualified conversation** requires affirmative answers to every required screen question in the validation brief and a completed interview about a recent real run.
- A **real-job integration** requires the partner’s own 20–90 minute job to send lifecycle events and produce at least one observed run. A synthetic run, demo, or setup call does not count.
- A **commitment** is a dated, explicit paid-pilot acceptance at a price/range or a commitment to switch from a named workaround. “Keep me posted” does not count.

## Interview record

Capture notes immediately after each call, using the partner alias only.

```text
Partner alias:
Date / interviewer:
Qualifying job and cadence:
Who owns and responds to it:
Most recent specific run checked:
Current health/progress signals:
Exact steps used to decide "running vs stuck":
Last surprise/failure and consequence:
Current workaround and cost (time, money, or risk):
Access and security constraints:
Quoted language indicating pain or indifference:
Integration decision: yes / no / later, and why:
Paid-pilot or switching decision: yes / no / later, and why:
Next action and owner:
```

Do not record customer data, production logs, credentials, or job payloads. Quote only material the partner agrees can be retained for pilot research.

## Safe onboarding runbook

Use this only after a partner passes the screen and agrees to a pilot.

1. Confirm the job is real, runs unattended for roughly 20–90 minutes, and can be observed without sending data or secrets to PingStep.
2. Agree on a stable `job_key`, expected heartbeat interval, and—only if they want late detection—an expected duration. Record these in the tracker.
3. Ask the partner to generate a job-specific random token locally. They send only the SHA-256 hash for server configuration; the raw token stays in their environment.
4. Configure the server with the job token hash and job settings. Example:

   ```sh
   export PINGSTEP_JOB_TOKEN_HASHES_JSON='{"partner-job":"<sha256 token hash>"}'
   export PINGSTEP_JOB_CONFIG_JSON='{"partner-job":{"expected_update_interval_seconds":300,"expected_duration_seconds":3600}}'
   ```

5. Add explicit `started`, meaningful `step` or periodic `heartbeat`, and terminal `succeeded`/`failed` events to the script. Do not parse arbitrary logs in this pilot.
6. Set the partner’s approved webhook destination if they want alerts. Send one harmless test event before the real run.
7. Observe one real run in the dashboard. Record setup duration, any integration failure, and whether the current step/liveness view answered the partner’s actual question.
8. Conduct a five-minute debrief after the run. Ask for a paid-pilot or switching decision directly; record the answer verbatim.

## Required partner-facing boundaries

- PingStep receives event metadata only: run ID, job key, event type, timestamp, named step, optional counters, and a short safe message.
- Never include credentials, customer data, source data, SQL, full logs, stack traces, or job arguments in event data or alerts.
- The pilot does not provide guaranteed incident response, a replacement for existing monitoring, or a production SLA.
- A partner may revoke their token at any time; remove its hash and historical pilot data on request.

## Daily operating cadence

| Day | Minimum action | Evidence to update |
| --- | --- | --- |
| 1–2 | Send only approved outreach; screen responses. | Tracker source, date, screen result. |
| 3–6 | Complete five qualified conversations. | Interview records and exact pain/workaround evidence. |
| 5–10 | Onboard qualified partners who consent. | Real job, setup time, observed-run evidence. |
| 11–12 | Ask for commitment after real use. | Commitment type, alternative, decision maker, date. |
| 13–14 | Apply the success/kill criteria. | Written proceed, reposition, or stop decision. |

## Exit decision template

At the end of the window, fill this with observed evidence only:

```text
Qualified conversations: __ / 5
Real-job integrations: __ / 3
Paid-pilot or switching commitments: __ / 2
Most common existing substitute:
Strongest recurring pain, with source aliases:
Integration friction, with source aliases:
Decision: proceed / reposition / stop
Reason against the predefined success and kill criteria:
```
