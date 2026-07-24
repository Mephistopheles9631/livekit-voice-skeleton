# LiveKit Voice Pipeline Skeleton

A learning/portfolio scaffold for real-time voice AI work — the kind of
foundation needed before tackling a role like "real-time voice orchestration
engineer." Hand-rolled deliberately (not built on LiveKit's own Agents
framework) — the point is demonstrable from-scratch engineering experience,
not framework integration. See `PROJECT_SPEC.md` for the full phase-by-phase
plan and a dated log of what's actually been run and observed, not just what
the code "should" do.

## What's real here

- **Token/orchestration server** (`server/index.js`): issues short-lived
  LiveKit access tokens, tracks session start/resume/stop, notifies the
  agent process when a session starts/stops.
- **Client** (`client/`): connects to a LiveKit room over WebRTC, publishes
  the browser's real mic track, subscribes to and plays remote audio
  (including the agent's synthesized voice), runs real Silero VAD
  (`@ricky0123/vad-web`), and renders a live transcript + streamed assistant
  response panel.
- **Agent** (`agent/`): a separate service that joins each room as a bot
  participant and runs the actual voice AI pipeline —
  - **STT**: streams the human's audio to Deepgram, live interim/final
    transcripts.
  - **LLM**: feeds finished utterances to Claude, streaming the response,
    with real multi-turn conversation history within a session and a
    real system prompt (see Conversational memory below — both were
    missing until Phase 5).
  - **Barge-in**: a new transcript arriving while the agent is thinking or
    speaking aborts the in-flight LLM/TTS and clears any queued audio —
    genuinely live-triggerable, not simulated.
  - **TTS**: streams the LLM's output to ElevenLabs and publishes the
    synthesized audio back into the room as the bot's own track.
  - **Latency tracing**: one structured JSON line per turn
    (`agent/trace/turnTrace.js`) marking speech-start/STT-final/LLM-first-
    token/LLM-complete/TTS-first-byte/TTS-first-frame — documented
    explicitly as agent-process boundaries, not literal mic-to-speaker
    timestamps.

All of Phases 0–4 have been verified against the real LiveKit Cloud account
and real vendor APIs (Deepgram, Anthropic, ElevenLabs) — see the dated log
in `PROJECT_SPEC.md` for exactly what was observed, including a couple of
real bugs hit and fixed along the way (not just a clean success story):

- **ElevenLabs free-plan voice restriction**: the streaming API rejects any
  Voice Library voice on a free plan, and reports that failure as a normal
  message over an already-open socket rather than a WebSocket error — a
  real silent-failure bug (`TTS just produced no audio, no error anywhere`)
  until it was caught and fixed. Must use a **premade** voice from your own
  account, not the Voice Library — see `CONFIG.md`.
- **A barge-in race**: a turn's normal-completion handler could fire after
  a barge-in had already superseded it, double-firing an "end" event to the
  client — caught while writing tests, fixed with a stream-identity guard.
- **Audio came out as static**: a real concurrency bug — TTS audio chunks
  were pushed to the publisher fire-and-forget, but the publisher mutated a
  shared buffer across `await`ed native calls, so two chunks arriving close
  together could interleave and scramble playback. Root-caused with actual
  tools (captured ElevenLabs' raw output and verified it with
  `ffmpeg`/`ffprobe` first, to rule out a vendor-side problem before
  suspecting the pipeline), then fixed by extracting the framing logic into
  a serialized, independently-tested module (`agent/audio/pcmFramer.js`).
- **Then it played back at ~10x speed**: fixing the static above exposed a
  second bug underneath it. Ruled out the PCM data (verified clean via
  `ffmpeg`/`ffprobe` again) and ruled out a pacing issue (`@livekit/rtc-node`'s
  own bundled tests prove the native layer paces playback internally, so
  pushing frames without artificial delay is correct, not the bug). Found
  by reading `AudioFrame`'s actual source: it serializes frame data via
  `new Uint8Array(this.data.buffer)`, which ignores the array's `byteOffset`
  entirely — every frame here was a *view* into a shared buffer, so every
  frame after the first from the same buffer silently resent the first
  frame's bytes instead of its own. Most of the real audio was being
  discarded and replaced with repeats, packed into the same declared
  duration. Fixed with `.slice()` (copies into a fresh buffer at offset 0)
  and a regression test that encodes the exact bug and fix
  (`agent/audio/audioFrameSerialization.test.js`).

**Session persistence** (`server/sessionStore.js`): the token server's session bookkeeping
(what `/session/start|resume|stop` tracks) is Redis-backed when `REDIS_URL` is set, so a
session survives a restart of `livekit-voice-skeleton.service` — falls back to in-memory
(lost on restart) if `REDIS_URL` is unset, which is a deliberate default for zero-setup local
dev, not an oversight. Live-verified: started a real session, captured its `roomName`,
restarted the systemd service, and called `/session/resume` with the same `roomName` —
`200`, not `404`. Sessions carry a 6-hour sliding TTL (refreshed on every resume) so
abandoned ones self-clean in Redis rather than accumulating forever. Note the scope: this
covers the token server's bookkeeping only — the separate `agent` process's live pipeline
state (open STT/TTS connections, the LiveKit `Room` object) can't meaningfully survive a
process restart and isn't attempted here; the agent just rejoins fresh.

**Conversational memory** (`agent/turnOrchestrator.js`, `agent/memory/`): the agent recalls
facts about a user across separate sessions, not just within one call — and, as a prerequisite
fix, now actually has memory *within* a session too (previously every turn was a stateless
single-message call to Claude with no history and no system prompt at all). At session end,
`agent/memory/memoryExtractor.js` asks Claude to reduce the session's transcript into an
updated, merged bullet-list of durable facts (corrections replace old facts, not append to
them), stored in Redis (`agent/memory/userMemoryStore.js`, 180-day sliding TTL) keyed by the
user's real LiveKit identity — recovered for free from `RoomEvent.TrackSubscribed`, no protocol
changes needed. Next session, the stored facts are injected into the system prompt before the
first turn. **A real bug found and fixed during verification**: the first version of the
extraction prompt let Claude *continue* the transcript instead of summarizing it, inventing
facts that were never said — fixed by clearly wrapping the transcript as quoted data. Verified
against the real Anthropic API and real Redis (a simulated session's facts were recalled
exactly, and a correction in a later session replaced rather than duplicated the old fact);
the full voice-to-voice loop (say a fact, end the call, start a new one, hear it recalled) is
the one piece that still needs a live human test, same as this project's other audio claims.

## What's left (Phase 5)

- Fallback vendor(s) for STT/TTS with real failure detection (not a config
  flag) — vendor TBD, OpenAI was considered and dropped
- A second, cheaper/faster Claude model as the LLM-side fallback
- Cost-per-session-minute tracking

## Running it

1. Create a free project at https://cloud.livekit.io, and accounts at
   Deepgram, Anthropic, and ElevenLabs
2. Follow `CONFIG.md` to set up your `.env` — pay particular attention to
   the ElevenLabs voice ID note if TTS produces no audio
3. `npm install`
4. Start all three services: `npm start` (token server, :3011),
   `npm run start:agent` (agent, :3012), and serve `client/` via any static
   server (e.g. `npx serve client`) — or run them as systemd services (see
   the unit files this project's server was actually deployed with)
5. Open the client in a browser, click "Join Session," grant mic
   permission, and talk — you should see live transcripts, a streamed
   assistant response, and hear it talk back. Interrupt it mid-response to
   test barge-in.

## Testing

`npm test` runs the automated suite (Node's built-in test runner, zero
extra dependencies) — pure orchestration logic (turn state machine,
barge-in cancellation, token-server routes) tested against fake STT/LLM/TTS
adapters, no live API keys needed. CI runs this on every push via
`.github/workflows/test.yml`.

**What automated tests can't prove**: whether the VAD is actually accurate
against real ambient noise, whether a barge-in sounds clean, whether the
real vendor SDKs' behavior matches what these tests mock, or real latency
numbers. Those are the live-verified claims logged with dates in
`PROJECT_SPEC.md` — CI passing means the orchestration logic is correct
against documented vendor contracts, not that the voice AI works.
