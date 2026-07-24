# Scope of Work: SugarShan Proof-of-Concept Slice

## Context
Shany Ashkenazy (Founder/CEO, Sugar Holdings LLC) reviewed the `livekit-voice-skeleton`
repo and asked pointed follow-up questions before a Monday call. Two of her questions
exposed real, honestly-acknowledged gaps:

1. No real load/latency data exists (p50/p99) — the pipeline has never run under
   real concurrent load.
2. Cross-session conversational memory (`agent/memory/`) is real, wired-in code,
   but has never been verified end-to-end with an actual two-session test.

She also asked to see a small, quick proof of concept of "a slice of the
orchestration we talked about" (referring to the GPU warm-pool/pre-warming
architecture proposed in reply to her avatar cold-start question) — explicitly
framed as a two-way fit test, not a formal deliverable.

This document scopes a small, honest, high-signal POC that directly answers all
three points in one sitting, without overclaiming anything not actually run.

## Goal
Convert three "I have a plan / I haven't verified this" answers into three
pieces of real, demoable evidence:
- Real load/latency numbers (p50/p99) from the actual pipeline
- Real, observed proof that cross-session memory works end-to-end
- A small, honestly-labeled simulation of the GPU warm-pool orchestration idea

## Part 1 — Load/Latency Harness (primary deliverable, do this first)

**What it does:** spins up N simulated client sessions against the *real* running
token server + agent (not mocked), each session:
1. Requests a token via `POST /session/start`
2. Joins the LiveKit room as a real participant (reusing `client/client.js`'s
   join logic, headless via `@livekit/rtc-node` instead of a browser)
3. Publishes a short pre-recorded audio clip (a few seconds of real speech,
   not silence — Deepgram needs real signal) as if it were a live mic
4. Waits for and timestamps the full round trip: audio published → transcript
   received (via the `assistant`/`transcript` data topic already broadcast by
   `agentSession.js`) → first TTS audio frame received back
5. Repeats for a few turns per simulated session, then disconnects

**What it measures and logs:** per-turn round-trip latency for every simulated
session/turn, written to a simple CSV or JSON lines file — then a small script
computes and prints p50, p95, p99, min, max across all recorded turns.

**Honesty constraints:**
- Label this clearly as *synthetic concurrent load*, not real users — say so
  explicitly in the README/output, don't let the number imply more than it is.
- If p99 is bad, report it as-is. The value of this exercise is credibility,
  not a good-looking number — a fabricated or cherry-picked number is worse
  than an honest bad one.
- Note the known limitation already in `PROJECT_SPEC.md`: this measures
  agent-boundary timing (transcript → TTS-first-byte), not true
  mic-to-speaker hardware latency — state that distinction in the results.

**Suggested file location:** `loadtest/` at repo root
  - `loadtest/simulateSession.js` — one simulated client session
  - `loadtest/runLoadTest.js` — spins up N of the above concurrently, collects results
  - `loadtest/report.js` — reads results, prints p50/p95/p99/min/max
  - `loadtest/sample-audio/` — one or two short real speech clips to publish

**Exit criteria:** a real terminal output showing something like:
```
Sessions: 10 concurrent, 3 turns each (30 total turns)
p50: 1180ms   p95: 2340ms   p99: 3800ms   min: 810ms   max: 4100ms
```
with the honest caveat printed alongside it about what's measured.

## Part 2 — Live Cross-Session Memory Verification

**What it does:** a small, deliberately simple script/manual walkthrough:
1. Start a session as `test-user-1`, say something with a durable fact
   ("My name is Alex and I prefer short answers")
2. End the session (triggers `agentSession.js`'s `leave()` → `saveMemory()`)
3. Restart the agent process
4. Start a *new* session as the same `test-user-1`
5. Ask a question that only makes sense if the fact was remembered
   ("What's my name?") and capture the actual response

**Output:** a short transcript/log (or even a screen recording) showing the
before/after — this is the single most convincing artifact for question 4,
since it's the one thing that was previously "built but not proven."

**Honesty constraint:** if it *doesn't* work end-to-end on first try, that's
useful information — fix the real bug and note what it was, rather than
quietly hand-waving it. A found-and-fixed bug here is more credible than a
suspiciously perfect first run, consistent with the project's existing
pattern (the concurrency/serialization bugs already documented).

## Part 3 — GPU Warm-Pool Orchestration Simulation (stretch, if time allows)

**What it does:** a small standalone script (does NOT need to touch the real
LiveKit pipeline) that simulates the architecture proposed in the email reply:
- A pool of N "sessions" with randomized mock cold-start latency (e.g. 2-4s)
  and mock warm-start latency (e.g. <200ms)
- A pre-warm trigger function that can be called ahead of actual demand
- An idle-timeout-with-grace-period teardown, instead of instant shutdown
- A small report showing: with pre-warming vs. without, the effective
  user-perceived latency distribution across simulated sessions

**Honesty constraint:** label this explicitly as a simulation with mocked
timings, not integrated with any real GPU/avatar vendor — the value here is
demonstrating the orchestration logic and decision-making, not real numbers.

## What NOT to do
- Do not fabricate or round-trip-inflate latency numbers to look better.
- Do not present Part 3's mocked simulation as if it were tested against a
  real vendor.
- Do not skip logging a failure if Part 2 doesn't work on the first attempt —
  document it like any other real bug in this project.

## Suggested order of execution
1. Part 1 (highest signal, directly answers her most specific question)
2. Part 2 (fast once Part 1's session-spinning code exists, since it can reuse
   the same simulated-client logic)
3. Part 3 only if time remains before Monday
