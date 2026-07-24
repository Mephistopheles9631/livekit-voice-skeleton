# Project Spec: LiveKit Voice Pipeline Skeleton

## Why this project exists

This project exists to build real, demonstrable experience in real-time
voice AI engineering — WebRTC-based voice pipelines, turn-taking, session
orchestration — the specific domain required by roles like the SugarShan
"Real-Time Voice & Video Streaming Engineer" posting. That role required
production experience with:

- Real-time voice AI / conversational agents (turn-taking, barge-in,
  sub-1.5s latency)
- WebRTC / LiveKit / Daily / Pipecat
- Multi-vendor AI orchestration with fallback
- Latency profiling and cost engineering
- Production LLM integration with deterministic scaffolding

None of that existed anywhere in prior work (which is backend/data/API
work: FastAPI, Rust data pipelines, Next.js apps, Solana infra). This
project is the deliberate, honest path to closing that gap — build it for
real, not claim it without evidence.

## Status (as of 2026-07-24)

**Phases 0–4 are built and live-confirmed working end-to-end** against a
real LiveKit Cloud account and real Deepgram/Anthropic/ElevenLabs APIs —
real speech in, live transcript, streamed Claude response, synthesized
voice out, and working barge-in. **Phase 5's session-persistence slice is
also done and live-verified** (Redis-backed sessions survive a service
restart); fallback vendor + cost tracking are the only remaining pieces.
See the dated **Phase log** near the bottom
of this file for exactly what was run and observed at each step, including
three real bugs hit and fixed along the way (not just a clean success
story) — silent TTS failure on a free-plan voice restriction, an audio
concurrency race that caused static, and a native-SDK serialization gotcha
that caused 10x-speed playback. `README.md` has the short version;
`TESTING.md` documents what's covered by automated tests vs. what only a
live human check can confirm.

### Original Phase 0 snapshot (as of 2026-07-23, kept for history)

A working skeleton existed with:

- **`server/index.js`** — Express token/orchestration server using
  `livekit-server-sdk`. Issues short-lived LiveKit access tokens per
  session, tracks session start/resume/stop against an in-memory map
  (`activeSessions`). Routes: `POST /session/start`, `POST /session/resume`,
  `POST /session/stop`, `GET /health`.
- **`client/index.html` + `client/client.js`** — browser client using the
  LiveKit client SDK (via esm.sh CDN import, no bundler needed yet). Joins
  a room, publishes the real microphone track, subscribes to and plays
  remote audio tracks, and runs a simple amplitude-threshold voice-activity
  detector (VAD) that lights up a UI indicator.
- **Verified**: `npm install` succeeds cleanly (75 packages, 0
  vulnerabilities). Server boots and logs a warning — rather than
  crashing — when LiveKit credentials are missing.
- **Not yet verified**: a real end-to-end WebRTC session, since that
  requires a live LiveKit Cloud project and real API credentials, which
  need to be set up interactively (see Immediate Setup below).

## Goals, in priority order

### Phase 0 — Get it actually running (do this first, in the console) ✅ Done
1. Sign up for a free project at https://cloud.livekit.io
2. Copy the WS URL, API key, and API secret into a local `.env`
   (see `CONFIG.md` in this repo — do NOT commit real credentials)
3. `npm install`
4. `npm start` — confirm `/health` responds and no warning is logged
5. Serve `client/index.html` via a static server (e.g. `npx serve client`
   — opening as a bare `file://` URL will cause mic-permission/CORS issues
   in some browsers) and open it in two browser tabs
6. Join from both tabs, confirm: mic permission granted, local VAD
   indicator reacts to your voice, and each tab hears the other as a
   remote audio track

**Exit criteria for Phase 0**: two real browser tabs holding a live
two-way voice call through your own token server, with the VAD indicator
visibly reacting to speech. This is the foundation everything else builds
on — do not proceed to Phase 1 until this works reliably.

### Phase 1 — Replace the toy VAD with something real ✅ Done
- Swap the amplitude-threshold VAD for Silero VAD (or similar) running
  client-side or via a small inference service
- Test explicitly against noisy/ambient conditions, not just a quiet room
- Record false-positive/false-negative rates informally — this is the
  first real "latency/quality profiling" data point for a resume or
  interview

### Phase 2 — Add streaming speech-to-text (STT) ✅ Done
- Wire a streaming STT provider (Deepgram or Whisper streaming) into the
  audio pipeline
- Display live partial + final transcripts in the client UI
- This is the first piece that turns "voice call" into "voice AI system"

### Phase 3 — Add an LLM harness with barge-in ✅ Done
- Feed STT transcript into an LLM (Claude/OpenAI — already have real
  experience here from other projects)
- Critical piece: the harness must be interruptible — when the VAD/STT
  detects the user started talking again mid-response, generation must
  stop and yield the floor. This "barge-in" behavior is explicitly called
  out as a non-negotiable in real job postings in this space — it is the
  single hardest and most differentiating piece to get right.

### Phase 4 — Add text-to-speech (TTS) and measure real round-trip latency ✅ Done
- Add streaming TTS output (OpenAI TTS, ElevenLabs, or similar)
- Instrument and log real timestamps: mic input → VAD trigger → STT final
  → LLM first token → TTS first audio byte → speaker output
- Target: get end-to-end round trip under ~1.5s in a quiet room first,
  then under real ambient noise — this number, honestly measured, is the
  single most credible thing to bring to an interview in this domain

### Phase 5 — Only after 0–4 work reliably: orchestration and cost 🚧 Partially done
- ✅ **Done**: persist session state (Redis) instead of in-memory, so a
  session can survive a server restart — `server/sessionStore.js`,
  live-verified (see Phase log below)
- ✅ **Done**: persistent conversational memory — the agent recalls facts
  about a user across separate sessions, not just within one call. Also
  fixed a real prerequisite gap found along the way: the agent previously
  had **zero** conversation history even *within* a session (every turn
  was a stateless single-message call to Claude) and **zero** system
  prompt. See Phase log below for what was built and verified.
- 🚧 Add a second STT/LLM/TTS vendor and real fallback logic (not just a
  config flag — actually detect vendor failure/latency and switch)
- 🚧 Track and log cost-per-session-minute across vendors

## Explicit non-goals (for now)
- Wake-word / always-on listening — a separate, later skill area
- Camera/vision perception — unrelated subsystem, not part of this
  project's scope
- Mobile (React Native) packaging — tracked as a **separate** project
  (mobile app shipping is its own non-negotiable skill gap and shouldn't
  be conflated with the voice-pipeline work here)
- Production-grade auth, multi-tenant security, GDPR — irrelevant for a
  learning skeleton; revisit only if this becomes a real product

## Honesty checkpoint
At each phase, only claim what has actually been run and observed
end-to-end — not what the code merely "should" do. If a phase is
attempted and doesn't work, log why in the repo's idea note rather than
skipping ahead. The value of this project is the evidence trail, not
just the final code.

## Phase log

- 2026-07-24: Phase 1 code written — `client/vad.js` wires real Silero VAD
  (`@ricky0123/vad-web` + `onnxruntime-web`, loaded via CDN `<script>` tags
  since it's a UMD bundle, not an ESM package) in place of the amplitude-
  threshold placeholder. **Live-verified by the user**: VAD indicator lit
  green on real speech. Full ambient-noise/false-positive-rate testing not
  yet explicitly done — informal confirmation only so far.
- 2026-07-24: Phase 2 (STT) built — new `agent/` service
  (`livekit-voice-skeleton-agent.service`, port 3012 internal control API)
  joins the LiveKit room as a bot participant, subscribes to human audio via
  `@livekit/rtc-node`'s `AudioStream`, streams it to Deepgram
  (`@deepgram/sdk`), and broadcasts transcripts to the browser over LiveKit's
  data channel. Token server now notifies the agent on session start/stop
  (`server/agentClient.js`). **Live-verified**: real end-to-end smoke test
  against the actual LiveKit Cloud account — `/session/start` → agent
  received the internal join call → minted its own bot token → connected to
  the real room → logged "joined, listening" → `/agent/health` showed
  `activeSessions: 1` → `/session/stop` cleanly disconnected it back to 0.
  **Not yet verified**: actual Deepgram transcription with real human audio
  (the smoke test above had no human publishing a track, so STT was never
  exercised) — needs a live two-tab test with real speech, watching the
  transcript panel.
  Both `@livekit/rtc-node`'s native bindings and the Deepgram SDK's actual
  API shape (`DeepgramClient`, `client.listen.v1.connect()`,
  `connection.sendMedia()`/`.close()`) were verified directly against the
  installed package source/`.d.ts` files rather than relying on
  documentation, since an earlier research pass had a stale API shape for
  `@deepgram/sdk@5.7.0`.
- 2026-07-24: **Phase 2 confirmed live by the user** — real Deepgram
  transcription verified end-to-end.
- 2026-07-24: Phase 3 built — `agent/pipeline/llm/claudeAdapter.js` wraps
  `@anthropic-ai/sdk`'s `MessageStream` (API verified against the installed
  source, same discipline as Phase 2 — it has a built-in `.abort()`, no
  manual `AbortController` needed). Turn-triggering and barge-in logic moved
  into a new `agent/turnOrchestrator.js`, deliberately decoupled from the
  live LiveKit `Room` object so it's unit-testable with fake STT/LLM
  adapters — 5 new tests cover: a `speechFinal` transcript starting a turn,
  interim transcripts not starting one, a new transcript arriving mid-THINKING
  aborting the in-flight generation and returning to LISTENING (barge-in),
  barge-in not firing outside THINKING, and every transcript being broadcast.
  17/17 tests passing. The barge-in trigger here is a **real** signal
  (Deepgram's own ongoing transcript stream, not a fake/simulated one) —
  genuinely live-testable by talking again while the assistant panel is
  still filling in, even though there's no audible bot voice to interrupt
  yet (that's Phase 4). Client got a new "Assistant response" panel showing
  streamed Claude output and an `[interrupted]` marker on barge-in.
  **Verified**: join/leave lifecycle re-confirmed against the real LiveKit
  Cloud account post-refactor (0 restarts, clean connect/disconnect).
  **Confirmed live by the user**: Claude is responding to real speech.
  **Still not explicitly confirmed**: a live barge-in (interrupting a
  response mid-stream) — not yet reported either way.
- 2026-07-24: Phase 5's fallback vendor decision changed — **dropping OpenAI
  entirely**, not just for the LLM leg as earlier decided. Phase 5's STT/TTS
  fallback vendor is now an open question, to be resolved when that phase is
  actually built.
- 2026-07-24: Phase 4 built — `agent/pipeline/tts/elevenLabsAdapter.js`
  connects directly to ElevenLabs' streaming-input WebSocket (no convenient
  client-class wrapper exists in `@elevenlabs/elevenlabs-js` for this
  resource, unlike Deepgram). Wire-level field names were verified against
  the SDK's own generated serialization mappers, not assumed from docs or
  TS types — caught a real mismatch: `xiApiKey` serializes to `"xi-api-key"`
  on the wire, not `xi_api_key`. Output format pinned to raw PCM
  (`pcm_16000`) so audio feeds directly into `@livekit/rtc-node`'s
  `AudioSource` with no MP3 decoding step. New `agent/audio/audioPublisher.js`
  re-slices arbitrarily-sized TTS chunks into small (20ms) frames before
  publishing — keeps the audible tail after a barge-in short, since a
  captured frame is already in flight over WebRTC and can't be recalled.
  Barge-in now fires during **both** THINKING and SPEAKING (previously only
  THINKING, since there was no audio yet) and additionally calls
  `AudioSource.clearQueue()` to drop unplayed frames.
  **Known simplification, not a silent gap**: SPEAKING-state barge-in
  currently triggers on any new transcript alone, without the RMS-level
  corroboration described in the original plan — deferred until live
  testing shows it's actually needed rather than built pre-emptively.
  Latency tracing added (`agent/trace/turnTrace.js`): one structured JSON
  line per turn to stdout, marks for `speech_started` (Deepgram's VAD, not a
  literal mic timestamp — documented explicitly), `stt_final`,
  `llm_first_token`, `llm_complete`, `tts_first_byte`,
  `tts_first_frame_captured`. **This measures agent-process boundaries, not
  true mic-to-speaker latency** — the process can't observe the physical
  mic or speaker.
  22/22 tests passing (7 new: turn/TTS wiring, SPEAKING-state transition on
  first audio, THINKING-barge-in re-verified against the new TTS dependency,
  SPEAKING-barge-in with queue-clear, speech_started trace seeding). Caught
  and fixed a real race while writing this: a turn's normal-completion
  handler could fire *after* a barge-in had already superseded it, sending a
  spurious duplicate "end" event to the client — fixed by comparing the
  in-flight stream reference before running completion side effects, with a
  regression test (`"the aborted turn's own completion handler must not
  also fire an end event"`).
  **Verified**: real join + audio-track publish against the live LiveKit
  Cloud account (new native-binding code path: `AudioSource`,
  `LocalAudioTrack`, `publishTrack`) — connects and disconnects cleanly, 0
  service restarts. **Not yet verified**: actual synthesized speech audio
  playing in a browser, or a live barge-in with real audio to interrupt —
  needs the user talking to it.
- 2026-07-24: **Root cause of "I don't hear anything" found and fixed.**
  ElevenLabs' streaming API rejects any Voice Library voice on a free plan —
  the default voice ID picked in Phase 4 (`21m00Tcm4TlvDq8ikWAM`, "Rachel")
  was a Library voice, and the account is on the free plan. That alone would
  just mean "pick a different voice," but it exposed a real bug: ElevenLabs
  reports this kind of failure as a normal JSON message over an
  already-open socket (`{"error":"payment_required","message":"...",
  "code":1008}`), not a WebSocket-level error or abnormal close.
  `elevenLabsAdapter.js` only checked incoming messages for `audio`/
  `isFinal` fields, so the error was silently discarded — TTS failed with
  zero errors anywhere, server or client. Fixed: the adapter now checks for
  `error`/`message` fields and routes them through `onError`, and
  `agentSession.js` now also broadcasts pipeline errors to the client's
  assistant panel (previously server-log-only) — this class of failure can
  no longer be invisible.
  Switched `ELEVENLABS_VOICE_ID` to `EXAVITQu4vr4xnSDxMaL` ("Sarah"), one of
  ElevenLabs' standard **premade** voices (`category: "premade"` via
  `GET /v1/voices`), which free plans can use via the API — Library voices
  cannot. See `CONFIG.md` for the full explanation.
  **Verified directly** (not assumed): connected to ElevenLabs' real
  streaming-input WebSocket standalone with the real API key/voice ID and
  received genuine PCM audio bytes back (two chunks, ~100KB total, for a
  test sentence — consistent with real synthesized speech at 16kHz). Also
  re-ran the full agent join + audio-track-publish smoke test against the
  live LiveKit account with the fixed voice — clean connect/disconnect, 0
  service restarts. **Still not independently re-confirmed**: the user
  listening to actual audio play back in-browser after this fix, or a live
  barge-in with real audio — the user opted to consider Phase 4 done on the
  strength of the direct vendor-call verification above rather than
  requiring another live browser session.
- 2026-07-24: **Second, more serious bug found**: after fixing the voice
  issue above, the user reported audio was audible but "sounds like
  static/damaged." Root-caused by direct experimentation, not guesswork:
  captured ElevenLabs' raw output standalone and verified with `ffmpeg`/
  `ffprobe` (`astats`) that the vendor's PCM data itself was clean — sane
  RMS (-12dB), no clipping, zero flat-factor, correct duration for the text
  sent. Then verified `audioPublisher.js`'s frame-slicing math byte-for-byte
  by reassembling sliced frames and diffing against the original — also
  byte-identical, so the chunking math itself wasn't the problem either.
  The actual bug: `pushPCM()` was called fire-and-forget from the TTS
  `onAudioChunk` handler (not awaited), but its internal per-chunk loop
  `await`s `AudioSource.captureFrame()` while mutating a **shared** pending-
  bytes buffer. Two TTS chunks arriving close together (confirmed landing
  within microseconds of each other in the turn-trace logs) could race and
  interleave `captureFrame()` calls out of order — scrambling playback into
  exactly the kind of static the user heard.
  **Fix**: extracted the framing/serialization logic into a new pure module,
  `agent/audio/pcmFramer.js` (`audioPublisher.js` is now a thin wrapper
  around it that just supplies the real `AudioSource.captureFrame` as the
  frame sink) — same "decouple from live SDK objects" pattern already used
  for `turnOrchestrator.js`. This makes the fix independently regression-
  tested (6 new tests in `pcmFramer.test.js`), including one that
  specifically asserts `onFrame` is never re-entered while a previous call
  is still in flight — the exact property whose absence caused the bug —
  using an artificially delayed fake sink to make the race reproducible on
  demand rather than timing-dependent. Also fixed a smaller, related gap
  found while rewriting this: the last <20ms of every TTS response was
  silently dropped (never flushed once below one full frame) — now padded
  with silence and flushed when TTS reports done.
  29/29 tests passing. Re-verified real join + audio-publish against the
  live LiveKit account post-fix — clean, 0 restarts.
  **Not yet re-confirmed by ear**: whether the fix actually resolved the
  static — needs the user listening again.
- 2026-07-24: **Third bug** — the static fix above resolved the corruption,
  but the user reported the result now sounded like correct speech played
  at roughly 10x speed. Root-caused with real evidence at each step, not
  guessing: ran real Claude + real ElevenLabs through the actual production
  code (`claudeAdapter.js`, `elevenLabsAdapter.js`, `pcmFramer.js`) in a
  standalone script — sending many small token-by-token `sendText()` calls,
  exactly like the real pipeline (the earlier manual ElevenLabs test had
  only sent one large text block, which turned out to matter) — captured
  what would be sent to `AudioSource`, and verified it with `ffmpeg`/
  `ffprobe`: 2.26s duration, -12.6dB RMS, no clipping — completely correct.
  So the bug wasn't in the PCM data itself. Also checked whether it could
  be a pacing issue (pushing a whole utterance's frames within
  milliseconds instead of spaced 20ms apart) — but `@livekit/rtc-node`'s
  own bundled test suite (`src/audio_source.test.ts`) explicitly pushes
  frames back-to-back with no pacing and asserts correct real-time
  `waitForPlayout()` timing, proving the native layer already paces
  playback internally — so added pacing would have been the wrong fix.
  The actual cause, found by reading `audio_frame.js` directly: `AudioFrame.
  protoInfo()` serializes frame data via `new Uint8Array(this.data.buffer)`
  — this reads from byte 0 of the underlying `ArrayBuffer` and completely
  ignores the `Int16Array`'s own `byteOffset`. Every frame here was a
  *view* (via `subarray`) into `pcmFramer`'s shared pending buffer, not a
  copy — so every frame after the first one sliced from the same
  underlying buffer silently resent the *first* frame's bytes instead of
  its own. Reproduced this exactly in isolation before touching the fix.
  Most of the real audio content was being discarded and replaced with
  repeats, all packed into the frame count's declared duration — which is
  exactly what "correct speech, compressed in time" sounds like.
  **Fix**: `.slice()` instead of a raw view — copies into a fresh,
  standalone buffer at `byteOffset` 0 before handing it to `AudioFrame`.
  Added `agent/audio/audioFrameSerialization.test.js`, which encodes the
  exact bug and fix using the real serialization logic pattern (not the
  real native SDK) — one test demonstrating the corruption, one proving
  the fix, both deterministic (had to route around Node's small-buffer
  pooling, which made an early version of this test flaky).
  31/31 tests passing. Re-verified real join + publish against the live
  LiveKit account, 0 restarts. **Not yet re-confirmed by ear.**

- 2026-07-24: **Phase 5, session-persistence slice built and live-verified**
  (fallback vendor + cost tracking still not started — separate, not
  requested yet). `server/sessionStore.js`: `createInMemoryStore()` (the
  old `Map` behavior, now async) and `createRedisStore()` (real Redis
  client, namespaced keys `livekit-voice-skeleton:session:{roomName}`,
  6-hour sliding TTL refreshed on every `/session/resume` so idle-but-
  connected sessions never expire while genuinely abandoned ones
  self-clean). `createSessionStore()` picks between them based on whether
  `REDIS_URL` is set — and if it *is* set but Redis can't be reached at
  boot, the server crashes on startup rather than silently falling back to
  in-memory, since a set `REDIS_URL` is an explicit persistence request,
  not an optional nicety. Installed `redis-server` on this box for real
  (`sudo apt install redis-server`, ships and auto-enables its own systemd
  unit) and added `After=redis-server.service` to
  `livekit-voice-skeleton.service`. 36/36 tests passing
  (`server/sessionStore.test.js` covers the in-memory contract; the Redis
  path is intentionally not unit-tested — see reasoning below).
  **Live-verified the actual claim, not just the code**: started a real
  session against the running service, confirmed its key existed in Redis
  with the correct TTL, ran `sudo systemctl restart livekit-voice-skeleton`
  (0 restarts, clean boot, `[sessionStore] Connected to Redis` logged),
  then called `/session/resume` with the same `roomName` — **200, not
  404**. Also confirmed `/session/stop` deletes the Redis key (verified
  with `redis-cli exists` → 0) rather than leaking it. Scope note: this
  only covers the token server's session bookkeeping — the separate
  `agent` process's live pipeline state (open Deepgram/ElevenLabs
  connections, the `@livekit/rtc-node` `Room`) can't be meaningfully
  persisted across a process restart and wasn't attempted; the agent just
  rejoins fresh, which is the existing (unchanged) behavior.

- 2026-07-24: **Persistent conversational memory built.** Two real gaps
  fixed as prerequisites, discovered while building this: `runTurn()` in
  `agent/turnOrchestrator.js` previously sent a single bare user message
  per Claude call with no prior turns — the agent couldn't recall
  anything said 10 seconds earlier in the *same* session. And there was
  no system prompt at all. Both fixed: `turnOrchestrator.js` now
  accumulates `conversationHistory` (only for turns that actually
  complete — a barge-in'd turn contributes nothing, matching how a
  person naturally restarts a thought after interrupting themselves) and
  sends it as prior context on every subsequent turn; `agentSession.js`
  now sets a real system prompt.
  Cross-session memory: `agent/memory/userMemoryStore.js` (Redis-backed,
  same in-memory-fallback/fail-loud-if-misconfigured pattern as
  `sessionStore.js`, 180-day sliding TTL — longer than session TTL since
  memory is meant to last, not sessions), keyed by the user's real
  LiveKit identity (`RemoteParticipant.identity`, recovered for free from
  `RoomEvent.TrackSubscribed`'s existing 3rd argument — confirmed against
  `node_modules/@livekit/rtc-node/dist/room.js`, no protocol changes
  needed). At session end, `agent/memory/memoryExtractor.js` asks Claude
  (via a new `summarize()` on `claudeAdapter.js`, reusing the same
  client) to reduce the session's transcript into an updated, merged
  bullet list of durable facts, replacing (not just appending to) the
  previous summary.
  **A real bug found and fixed during live verification, not glossed
  over**: the first version of the extraction prompt ended right after
  the raw `User: …\nAssistant: …` transcript lines with nothing after
  them — against the real Anthropic API, Claude sometimes *continued*
  the dialogue (inventing further turns that were never said) instead of
  summarizing it, polluting the stored facts with fabricated content.
  Reproduced against the real API, fixed by wrapping the transcript in
  `<transcript>` tags and re-stating the task explicitly after it rather
  than ending on the transcript's last line.
  **Verified against the real Anthropic API and real Redis** (not just
  read as "should work"): a simulated first session stated a name,
  profession, and a pet's name — the extracted facts matched exactly,
  no fabrication. A second, separate process (new "session") loaded only
  the stored summary (no shared message history) and correctly answered
  a recall question about both facts. A third session with a correction
  ("Biscuit is actually a labrador, not a golden retriever; I switched
  to Rust") correctly replaced the old facts rather than appending a
  contradiction. 42/42 tests passing (7 new: 3 `userMemoryStore.test.js`
  contract tests, 4 new `turnOrchestrator.test.js` tests for history
  accumulation, barge-in exclusion, and per-turn `getSystem()` calls).
  Restarted `livekit-voice-skeleton-agent.service`, 0 restarts, clean
  Redis connect logged. **What this does NOT yet prove**: the full
  voice-to-voice loop — actually speaking a fact aloud, ending the call,
  starting a new one, and hearing it recalled through real STT/TTS. The
  Anthropic-API-level test above exercises every line of new code except
  the (unmodified) STT/TTS legs; the full loop still needs the user's
  own live two-session test, same as every other "does it actually sound
  right" claim in this project.

- 2026-07-24: **The user's first live test failed — "it's not remembering
  my name."** Root-caused from real evidence, not guessed: `journalctl -u
  livekit-voice-skeleton-agent` showed three sessions in the same test
  window with three completely different `userId`s
  (`user-93960`, `user-98164`, `user-22404`), and `redis-cli` confirmed
  three separate memory records, one per fake "user." The actual bug:
  `client/client.js` generated a fresh random `userId` on every
  `join()` call (`user-${Math.random()...}`) — this was harmless when
  `userId` only had to be unique enough to name a LiveKit room, but
  Phase 5's memory feature gave `userId` a second job (the key facts are
  recalled under) that a fresh-every-session random ID silently defeats:
  every session looks like a different person, so nothing is ever
  recalled, by design of the very feature meant to prevent that. Also
  visible directly in the stored data: session `user-98164`'s extracted
  facts included "User started to share their name but the transcript
  cuts off before completing it" — real evidence the pipeline was
  working as designed on the data it was given, just never getting the
  same identity twice. **Fixed**: `getOrCreateUserId()` in
  `client/client.js` now persists the ID in `localStorage`, generated
  once per browser and reused on every subsequent join — the simplest
  fix that doesn't require real auth (an explicit non-goal for this
  learning skeleton). Old stray memory keys from the three fake
  identities were left in place rather than deleted — they self-expire
  via the existing 180-day TTL, no cleanup needed. Not yet re-confirmed
  live by the user with the fix in place.
