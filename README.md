# LiveKit Voice Pipeline Skeleton

A learning/portfolio scaffold for real-time voice AI work — the kind of
foundation needed before tackling a role like "real-time voice orchestration
engineer." This is intentionally a skeleton: it demonstrates the real
mechanics (token auth, room join, audio publish/subscribe, basic VAD) but
does NOT yet implement the hard parts of a production system.

## What's real here

- **Token/orchestration server** (`server/index.js`): issues short-lived
  LiveKit access tokens, tracks session start/resume/stop against an
  in-memory session map. This is the real shape of a "session lifecycle"
  backend, just without persistence.
- **Client** (`client/`): actually connects to a LiveKit room over WebRTC,
  publishes the browser's real microphone track, subscribes to and plays
  remote audio, and runs a simple amplitude-based voice-activity detector.

## What's intentionally NOT implemented (the actual hard problems)

- **Turn-taking / barge-in**: the VAD here just lights up an indicator. A
  real system needs this signal wired into an LLM harness that can
  interrupt its own response mid-sentence when the user starts talking.
- **Sub-1.5s latency profiling**: no latency instrumentation yet. Real work
  would mean measuring mic-to-model-to-speaker round trip and optimizing
  each hop (STT, LLM inference, TTS, network).
- **Multi-vendor orchestration / fallback**: this only talks to LiveKit.
  A production system would route between multiple STT/LLM/TTS vendors
  with graceful degradation.
- **Wake-word detection**: not implemented — would need a dedicated
  always-on model (e.g. Porcupine) running client-side.
- **Persistent memory across sessions**: sessions are in-memory and
  disappear on server restart.

## Running it

1. Create a free project at https://cloud.livekit.io
2. Follow `CONFIG.md` to set up your `.env`
3. `npm install`
4. `npm start` (starts the token server on :3001)
5. Open `client/index.html` in a browser (serve it via any static server —
   opening as a bare `file://` will hit CORS issues with the mic permission
   prompt in some browsers)
6. Click "Join Session" — grant mic permission — you should see the local
   VAD indicator light up when you speak, and hear yourself if you open a
   second tab (it'll show as a remote participant).

## Next steps (in priority order for closing the gap toward production voice AI work)

1. Replace the amplitude VAD with a real model (Silero VAD) and measure
   false-positive rate in noisy audio
2. Add STT (e.g. Deepgram/Whisper streaming) and wire transcript output
   into a visible transcript panel
3. Add an LLM harness that can be told to stop generating when barge-in
   is detected
4. Add TTS output and measure full round-trip latency with real timestamps
5. Only after 1–4 work reliably: start thinking about multi-vendor fallback
   and cost-per-minute tracking
