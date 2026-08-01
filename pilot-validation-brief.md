# PingStep pilot validation brief

**Purpose:** test whether progress-aware monitoring is a painful enough problem for engineers to connect real jobs and pay to solve it. This is a research and integration pilot, not a product-build commitment.

## Evidence and assumptions

**Evidence provided:** PingStep is intended for unattended 20–90 minute scripts run outside CI/workflow platforms, including backups, migrations, batch jobs, and report generators.

**Assumptions to test:** these jobs are common enough among a focused user group; existing logs, cron alerts, and generic uptime monitors leave an important visibility gap; and teams will pay or switch tools for progress-aware status rather than merely wanting better notifications.

No customer interviews, integrations, usage data, or willingness-to-pay evidence has been collected yet. All claims below beyond the stated context are hypotheses.

## Primary target user

**The single target user:** the engineer who owns and is on call for production data-maintenance scripts (especially database migrations and recurring batch jobs) at a small or mid-sized software team.

**Why this user:** they directly feel the cost of uncertainty when a 20–90 minute job is slow, stalled, or silently failed; they can identify a real job to test; and they can usually choose or influence lightweight operational tooling. The scope intentionally excludes CI users, dedicated workflow-platform users, and teams seeking a broad observability replacement.

## Problem and falsifiable hypothesis

**Problem statement (hypothesis):** When an unattended production script runs outside CI or a workflow platform, its owner cannot quickly distinguish normal progress from a stall using their current tools. They spend time checking logs or hosts manually and learn about failure too late or with too little context.

**Falsifiable hypothesis:** If we recruit engineers who own these jobs, then at least 3 of 5 qualified interviewees will connect one real 20–90 minute job to a progress-aware pilot within two weeks, and at least 2 will make a paid-pilot or switching commitment after seeing it operate on that job.

## Design-partner qualification screen

Recruit only people who answer **yes** to all required questions:

1. Do you personally own or regularly respond to a production script that runs unattended for roughly 20–90 minutes?
2. Does it run outside a CI/CD or workflow-orchestration platform (for example, via cron, a host, a container, or a simple scheduler)?
3. Has this job run at least monthly in the last 90 days?
4. In the last 90 days, have you had to inspect logs, a host, or a dashboard to decide whether it was still progressing or stuck?
5. Can you safely connect one non-sensitive real job to a lightweight pilot in the next two weeks?

**Screen out:** people discussing only hypothetical future jobs, jobs under 20 minutes or over 90 minutes, CI/workflow-native jobs, and anyone unable to access a real job for a pilot.

## Interview questions

Ask for a specific recent run; do not pitch the solution before these questions.

1. “Tell me about the last unattended script you had to check on. What was it doing, and how long was it expected to run?”
2. “Walk me through exactly how you decided whether that run was healthy, slow, or stuck.”
3. “What signals did you have during the run—logs, timestamps, metrics, alerts—and what was missing?”
4. “Describe the last time this kind of job surprised you. What did you do, how long did it take, and what was the consequence?”
5. “What have you already changed or paid for to reduce this uncertainty? Why did that approach fall short or remain in place?”

## Pilot success criteria

The pilot succeeds only if all three thresholds are met:

- **5 qualified conversations:** screened engineers with a qualifying, recently-run job and firsthand operational experience.
- **3 real-job integrations:** participants connect an actual qualifying script and observe at least one completed or problematic run. A demo, synthetic script, or promise does not count.
- **2 commitments:** two participants explicitly agree either to a paid pilot at a stated price/range or to replace/switch from a named current workaround when the pilot is available. Record the job, decision maker, alternative, commitment type, and date.

## Kill criteria and response

Stop or narrow the pilot if any of the following is true after 10 screened conversations or the two-week window:

- Fewer than 5 people qualify: the target segment/job definition is too narrow or outreach is reaching the wrong audience.
- Fewer than 3 qualified people will connect a real job despite a clear, safe integration path: the pain is not urgent enough, access is the real barrier, or the integration requirement is wrong.
- Fewer than 2 commitments after real-job use: do not build further; document the objections, current substitutes, and willingness-to-pay evidence, then either reposition around the strongest recurring pain or end this problem framing.
- Most participants say logs/alerts/orchestrators already answer the question adequately: end the progress-monitoring premise for this segment rather than adding features.

If the test fails, publish an internal learning note with the interview evidence and choose one next action only: revise the target-user definition, test a different job type, simplify the integration thesis, or stop the initiative. Do not interpret polite interest as validation.

## Outreach message

> I’m interviewing engineers who personally own unattended production scripts—backups, migrations, batch jobs, or report generators—that run for about 20–90 minutes outside CI/workflow tools. I’m trying to understand how you tell whether a run is progressing versus stuck, based on a real recent example. If that’s part of your work and you could consider connecting one safe, non-sensitive job to a two-week pilot, would you be open to a 25-minute conversation? I’m looking for candid operational detail, not a product pitch.

## Two-week execution plan

| Timing | Activity | Output |
| --- | --- | --- |
| Days 1–2 | Finalize screener, recruit from relevant engineering contacts/communities, and schedule interviews. | 10+ screened prospects; 5 qualified conversations booked. |
| Days 3–6 | Run five interviews; capture the job, current signals, failure story, existing workaround, access constraints, and verbatim commitment language. | Interview notes and a qualification/commitment tracker. |
| Days 5–10 | Invite qualified participants to connect one safe real job; support integration while recording friction and observed runs. | At least 3 real-job integrations or documented refusal reasons. |
| Days 11–12 | Review each integration with the participant; ask directly for paid-pilot or switching commitment, including the current alternative. | Commitment decisions from all integrated participants. |
| Days 13–14 | Compare results with the success and kill criteria; write the learning note and make one explicit proceed, reposition, or stop decision. | Evidence-backed pilot decision. |

## Pilot boundaries

Participants should use non-sensitive jobs only. Do not request production credentials, job payloads, customer data, or logs containing secrets. The pilot tests job-progress visibility; it does not promise incident response, workflow orchestration, or replacement of existing observability systems.
