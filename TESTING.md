# Testing

`npm test` runs the full suite via Node's built-in test runner (`node --test`, zero extra
dependencies). CI runs the same command on every push/PR via
`.github/workflows/test.yml`.

**The one thing to understand before reading the table below**: CI passing proves the
orchestration logic is correct against documented/mocked vendor contracts. It does not prove
the voice AI actually works — that requires a human, talking to it, listening to what comes
back. Several real bugs in this project (see `PROJECT_SPEC.md`'s Phase log) only manifested
in live, real-audio use and would not have been caught by any of the tests below, however
thorough — one wasn't even reproducible with a single-shot test input, only with the real
pipeline's many-small-chunk streaming pattern.

## Automated (`npm test`, no live API keys or audio needed)

| Area | File | What it actually proves |
|---|---|---|
| Token server routes | `server/index.test.js` | `/session/start\|resume\|stop\|health` behave correctly. `AccessToken.toJwt()` signs locally with no network call, so this needs no real LiveKit account. Spawned with `REDIS_URL` unset, so this also exercises the in-memory session store path. |
| Session store contract | `server/sessionStore.test.js` | `createInMemoryStore()`'s get/set/has/delete/size behave correctly. Doesn't touch `createRedisStore()` — real Redis persistence is proven live instead (see below), not mocked. |
| Turn state machine | `agent/state/turnState.test.js` | Only the declared transitions are allowed; invalid ones throw and leave state unchanged. |
| Turn orchestration + barge-in | `agent/turnOrchestrator.test.js` | Against fake STT/LLM/TTS adapters: a finished utterance starts a turn; interim transcripts don't; a new transcript during THINKING or SPEAKING aborts the LLM stream, stops TTS, clears queued audio, and returns to LISTENING — and does *not* double-fire completion events for a turn that was already superseded (a real bug, caught by this exact test). Also: a second completed turn's outgoing `messages` includes the first turn's user+assistant pair (in-session memory); a barge-in'd turn contributes nothing to history; `getSystem()` is called fresh per turn, not snapshotted once. |
| User memory store contract | `agent/memory/userMemoryStore.test.js` | `createInMemoryStore()`'s get/set behave correctly. Doesn't touch `createRedisStore()` or the actual extraction/summarization call — those are proven live instead (see below). |
| PCM re-framing/serialization | `agent/audio/pcmFramer.test.js`, `agent/audio/audioFrameSerialization.test.js` | Frames slice and reassemble byte-for-byte correctly; concurrent fire-and-forget pushes never re-enter the frame sink out of order (the real cause of an audible static bug); a raw TypedArray *view* into a shared buffer serializes the wrong bytes when handed to the native SDK, while `.slice()` doesn't (the real cause of a 10x-speed-playback bug). |
| Latency trace math | `agent/trace/turnTrace.test.js` | Delta computation from marks is correct; emits exactly one JSON line per finished trace. |
| Load-test percentile math | `loadtest/report.test.js` | `computeStats()`'s nearest-rank p50/p95/p99/min/max are correct, including empty/single-value/unsorted-input edge cases. Doesn't touch the actual live-load-generation code (`simulateSession.js`, `runLoadTest.js`) — that's vendor/LiveKit-touching and proven live instead, same as `claudeAdapter.js`/`deepgramAdapter.js`/`elevenLabsAdapter.js`. |
| GPU warm-pool simulation logic | `loadtest/warmPoolSim.test.js` | Against an injected deterministic random source: a pre-warmed slot gives a warm start; no pre-warmed slot cold-starts; pool exhaustion correctly queues and charges wait time; a slot freed within its grace period is reused warm, one reused after the grace period expires cold-starts. Pure logic, zero vendor dependency, so — unlike the rest of `loadtest/` — this *is* unit-tested, same category as `turnState.js`/`pcmFramer.js`. |

## Must stay manual (a human, live, per PROJECT_SPEC.md's honesty checkpoint)

- Whether the VAD is actually accurate against real ambient noise (false-positive/negative
  rate) — Phase 1's stated exit criteria, never something a unit test can measure. **Verified
  live by the user (2026-07-24)**: with real background/non-speech noise present, Silero VAD
  correctly does not fire — see `PROJECT_SPEC.md`'s Phase 1 log.
- Whether a barge-in interrupt actually *sounds* clean, not just whether the state machine
  transitioned correctly.
- Whether the real vendor SDKs behave the way the fakes/mocks in the tests above assume —
  three real production bugs in this project were vendor-integration bugs invisible to any
  of the tests above until run against real audio/real APIs.
- Real round-trip latency numbers (`turnTrace.js`'s output is real data, but reading and
  judging it — "is under 1.5s good enough" — is a human call, not an assertion).
- A real fallback triggered by a genuine vendor outage, once Phase 5 lands — the
  `FORCE_FALLBACK_*` flags let you demonstrate the *mechanism* on command, which is different
  from proving real-world reliability.
- That Redis-backed sessions actually survive a restart — verified once, live: started a real
  session, restarted `livekit-voice-skeleton.service`, and confirmed `/session/resume` still
  returned `200` for the same `roomName` (not `404`). A unit test against
  `createInMemoryStore()` can't prove this; it would need to fake the exact thing (a real
  process restart against a real Redis) that makes the claim worth making.
- Cross-session conversational memory — verified against the real Anthropic API and real
  Redis (not mocked): a simulated session's stated facts were extracted with no fabrication,
  a separate process loading only the stored summary correctly answered a recall question,
  and a corrective follow-up session replaced the old facts rather than duplicating a
  contradiction. This caught a real bug (the extraction prompt letting Claude continue the
  transcript instead of summarizing it — see `PROJECT_SPEC.md`'s Phase log) that a mocked
  test would never have surfaced, since it depended on the real model's actual behavior, not
  an assumed contract. **Still not covered even by that**: the full voice-to-voice loop — a
  human speaking a fact aloud, ending the call, starting a new one, and hearing it recalled
  through real STT/TTS. That needs a live human test, same as every other audio-quality claim
  here.
- SugarShan POC Part 1's real load numbers (`loadtest/runLoadTest.js` against the live
  services) and Part 2's cross-session memory proof across a real agent-process restart
  (`loadtest/verifyMemory.js`) — both vendor/LiveKit/Redis-touching and live-only by design,
  same reasoning as the rest of this section. Real, dated results in `PROJECT_SPEC.md`'s
  SugarShan POC section; see `loadtest/README.md` for exactly what each script measures and
  its honesty labels/known limitations.
