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

## Current state (as of 2026-07-23)

A working skeleton exists with:

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

### Phase 0 — Get it actually running (do this first, in the console)
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

### Phase 1 — Replace the toy VAD with something real
- Swap the amplitude-threshold VAD for Silero VAD (or similar) running
  client-side or via a small inference service
- Test explicitly against noisy/ambient conditions, not just a quiet room
- Record false-positive/false-negative rates informally — this is the
  first real "latency/quality profiling" data point for a resume or
  interview

### Phase 2 — Add streaming speech-to-text (STT)
- Wire a streaming STT provider (Deepgram or Whisper streaming) into the
  audio pipeline
- Display live partial + final transcripts in the client UI
- This is the first piece that turns "voice call" into "voice AI system"

### Phase 3 — Add an LLM harness with barge-in
- Feed STT transcript into an LLM (Claude/OpenAI — already have real
  experience here from other projects)
- Critical piece: the harness must be interruptible — when the VAD/STT
  detects the user started talking again mid-response, generation must
  stop and yield the floor. This "barge-in" behavior is explicitly called
  out as a non-negotiable in real job postings in this space — it is the
  single hardest and most differentiating piece to get right.

### Phase 4 — Add text-to-speech (TTS) and measure real round-trip latency
- Add streaming TTS output (OpenAI TTS, ElevenLabs, or similar)
- Instrument and log real timestamps: mic input → VAD trigger → STT final
  → LLM first token → TTS first audio byte → speaker output
- Target: get end-to-end round trip under ~1.5s in a quiet room first,
  then under real ambient noise — this number, honestly measured, is the
  single most credible thing to bring to an interview in this domain

### Phase 5 — Only after 0–4 work reliably: orchestration and cost
- Add a second STT/LLM/TTS vendor and real fallback logic (not just a
  config flag — actually detect vendor failure/latency and switch)
- Track and log cost-per-session-minute across vendors
- Persist session state (Postgres/Redis) instead of in-memory, so a
  session can survive a server restart

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
