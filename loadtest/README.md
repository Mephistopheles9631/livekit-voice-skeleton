# SugarShan POC — loadtest/

Three pieces of real, honestly-labeled evidence, per `../SCOPE_OF_WORK_sugarshan_poc.md`:
real load/latency numbers under concurrency, a scripted cross-session-memory proof (including
a real process restart), and a small, clearly-labeled simulation of the GPU warm-pool idea.
Full dated results are logged in `../PROJECT_SPEC.md`'s "SugarShan POC" section — this file
covers what each script does and how to run it.

## Part 1 — Load/Latency Harness

```
npm run loadtest -- --sessions 10 --turns 3 --server http://127.0.0.1:3011
npm run loadtest:report -- loadtest/results/<file>.jsonl   # re-analyze a saved run
```

Spins up N simulated client sessions against the **real, running** token server + agent (not
mocked) — each connects via `@livekit/rtc-node` headlessly (same join logic as
`client/client.js`, no browser), publishes a real synthesized-speech clip as if it were a live
mic, and times the round trip via the same `transcript`/`assistant` data-channel events and
audio track the real browser client uses.

- `lib/liveClient.js` — shared headless join/publish/subscribe helper (Parts 1 & 2).
- `prepareSampleAudio.js` — one-time prep script; synthesizes the fixed clips in
  `sample-audio/` via the project's real ElevenLabs adapter. Re-run only if the clips need
  regenerating.
- `simulateSession.js` — one simulated session, N turns.
- `runLoadTest.js` — spins up N sessions concurrently, writes `results/<timestamp>.jsonl`.
- `report.js` — `computeStats()` (unit-tested) + prints the p50/p95/p99 summary.

### Honesty labels (read before trusting any number below)

- **Synthetic concurrent load, not real users.** Scripted clients with a fixed, repeated
  phrase — a measure of pipeline/infra behavior under N simultaneous connections, not of real
  traffic patterns.
- **Agent-boundary timing, not mic-to-speaker.** Same scope caveat as
  `agent/trace/turnTrace.js`: "publish" is this script sending PCM into the room, "first
  audible response frame" is this script's own subscribed track decoding a frame whose RMS
  exceeds a voice-activity threshold (see below) — not physical hardware latency.
- **Clean synthesized audio, not noisy real-world mic conditions.** Not a measurement of STT
  accuracy under real acoustic conditions.
- **Round-trip is reported for each session's FIRST turn only.** See "Known limitations"
  below — this is a real, investigated finding, not an arbitrary omission.

### Known limitations (found, investigated, and partially fixed while building this)

1. **`AudioStream` yields frames continuously from the moment a track is subscribed,
   independent of real content.** The agent publishes its (initially silent) voice track
   immediately on join, so a naive "first frame received" signal fired ~90ms after publish —
   physically impossible for a real STT+LLM+TTS round trip. **Fixed**: `liveClient.js` filters
   for frames whose RMS exceeds `AUDIO_LEVEL_THRESHOLD = 0.02`, the same amplitude-threshold
   approach and value this project's own barge-in detection already uses
   (`BARGE_IN_LEVEL_THRESHOLD` in `CONFIG.md`).
2. **A stale TTS connection's late error could be misattributed to a later, unrelated turn.**
   `agent/turnOrchestrator.js` never explicitly closes a turn's ElevenLabs connection on normal
   completion (nothing proactively ends it — see below); it can still be open when the
   vendor's own ~20s idle timeout force-closes it and reports that as an error. Without a
   guard, that late error fired unconditionally, in one observed case corrupting a *different,
   later* turn's measurement. **Fixed** in `agent/turnOrchestrator.js` with a supersession
   guard (`if (activeTTS === myTTS) onError(err)`), the same pattern already used for the
   barge-in completion-race guard in the same file — covered by a new regression test in
   `agent/turnOrchestrator.test.js`.
3. **Not fixed — round-trip for a session's 2nd/3rd turn is unreliable under this harness's
   own concurrency, and is excluded from the headline numbers rather than reported as if
   solid.** Root cause, as far as it was investigated: this harness runs all N simulated
   sessions in ONE Node process, each with its own concurrent native-audio-FFI consumer
   (`AudioStream`); under load, evidence points to that receive pipeline falling behind and
   delivering buffered frames in backlogged bursts rather than at a reliable real-time pace,
   so a later turn's "first loud frame after publish" can catch stale, backlogged audio. An
   inter-turn active quiet-detection wait (`simulateSession.js`'s `waitForQuiet`, replacing an
   initial fixed 500ms gap that turned out to be unreliable for a different reason — see the
   dated log in `PROJECT_SPEC.md`) measurably helped but did not fully resolve it. This is a
   limitation of **this specific single-process load-generator's own architecture**, not of
   the real pipeline under test — the real pipeline handles concurrent independent rooms today
   regardless (that's exactly what `agent/index.js`'s per-`roomName` `AgentSession` map does).
   A process-per-session harness redesign would likely fix this but was judged out of scope
   for this POC's timeline; noted here as honest, explicit follow-up work, not hidden.
4. **A real vendor capacity ceiling, not a harness bug**: at 10-way concurrency, some turns
   failed outright with `ElevenLabs error (1008): Too many concurrent requests... maximum of 4
   concurrent requests`. This is real signal, not noise — see `PROJECT_SPEC.md` for the exact
   numbers and what it means for capacity planning on the current vendor plan.

Manual cleanup (optional — these self-expire via existing TTLs, see `agent/memory/
userMemoryStore.js` and `server/sessionStore.js`):
```
redis-cli --scan --pattern 'livekit-voice-skeleton:memory:loadtest-*' | xargs -r redis-cli del
redis-cli --scan --pattern 'livekit-voice-skeleton:session:session-loadtest-*' | xargs -r redis-cli del
```

## Part 2 — Live Cross-Session Memory Verification

```
node loadtest/verifyMemory.js --phase=a
sudo systemctl restart livekit-voice-skeleton-agent.service
node loadtest/verifyMemory.js --phase=b
```

Two independently-runnable phases (an interactive single-script design was tried first and
dropped — restarting a systemd service needs to happen from a real shell between the two live
sessions, not from inside a paused Node process). Phase A states a fact as `userId
poc-memory-test-1`, then polls Redis directly (not just trusting the agent "should" have
saved) until the memory key updates, and prints the stored facts. After a real agent-process
restart, phase B opens a brand-new room as the same `userId` and asks a recall question,
printing the agent's actual reply plus a heuristic pass/fail check (a case-insensitive
substring match — read the full printed reply yourself, don't just trust the heuristic).

Real, dated result in `PROJECT_SPEC.md`.

## Part 3 (stretch) — GPU Warm-Pool Orchestration Simulation

```
npm run loadtest:warmpool
```

`warmPoolSim.js` — a pure discrete-event simulation (`simulate()`, unit-tested in
`warmPoolSim.test.js` against an injected deterministic random source), run entirely in
virtual/logical time via a sorted event list, not real `setTimeout` waits. Replays the *same*
randomized request timeline against two scenarios for a fair comparison: a naive baseline (no
pre-warming, instant teardown) vs. a pre-warmed pool with idle-timeout-with-grace-period
teardown (a slot freed within the grace window is reused warm instead of torn down).

**Labeled explicitly, every run**: mocked timings, virtual simulated time, **not** integrated
with any real GPU/avatar vendor. The value is demonstrating the orchestration/decision logic
(pre-warm ahead of demand, grace-period reuse, pool-capacity queueing), not real numbers.
