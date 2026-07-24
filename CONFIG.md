# Configuration

Create a local `.env` file (not committed, gitignored) with these variables.

## Phase 0 — LiveKit (required to run anything)

Get these from a free project at https://cloud.livekit.io.

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
PORT=3011
```

## Agent internal control channel

The token server (`server/index.js`) notifies the agent process (`agent/index.js`) over a
localhost-only HTTP call when a session starts/stops — never proxied by nginx, never leaves
the box. `AGENT_INTERNAL_SECRET` can be any random string; generate one with
`openssl rand -hex 32`.

```
AGENT_PORT=3012
AGENT_INTERNAL_URL=http://127.0.0.1:3012
AGENT_INTERNAL_SECRET=<random>
```

## Phase 2 — Deepgram (streaming STT)

Get an API key from https://console.deepgram.com.

```
DEEPGRAM_API_KEY=
DEEPGRAM_MODEL=nova-3
```

## Phase 3 — Anthropic Claude (LLM)

Get an API key from https://console.anthropic.com. Used for both the primary and fallback
model — the LLM leg intentionally has no second *vendor*, just a cheaper/faster fallback
model (see `PROJECT_SPEC.md` Phase 5 for why).

```
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-5
CLAUDE_FALLBACK_MODEL=claude-haiku-4-5-20251001
```

## Phase 4 — ElevenLabs (streaming TTS)

Get an API key from https://elevenlabs.io.

**Free-plan voice restriction (hit this for real, see PROJECT_SPEC.md Phase 4 log):**
ElevenLabs' streaming-input API rejects any voice from the shared **Voice Library** on a free
plan — "Free users cannot use library voices via the API. Please upgrade your subscription to
use this voice." `ELEVENLABS_VOICE_ID` must be a **premade** voice already in your own
account's "My Voices" (check `GET /v1/voices` with your key, or the ElevenLabs dashboard —
look for `category: "premade"`, not a voice you searched for in the Voice Library). The
default below (`EXAVITQu4vr4xnSDxMaL`, "Sarah") is one of ElevenLabs' standard premade voices
and works on a free plan. Also note: an API key can be scoped without `voices_read`
permission, in which case `GET /v1/voices` itself will 401 even though streaming TTS still
works — check your key's permissions in the ElevenLabs dashboard if you need to look up
voices yourself.

```
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL=eleven_flash_v2_5
```

## Phase 5 — session persistence + conversational memory (done) + fallback vendor (not yet built)

**Session persistence** (`server/sessionStore.js`): `REDIS_URL` set → sessions (tracked by
`/session/start|resume|stop`) are stored in Redis and survive a restart of
`livekit-voice-skeleton.service`; unset → falls back to an in-memory `Map` (fine for local
dev, but sessions are lost on every restart). This is a meaningful distinction, not just a
convenience default: if `REDIS_URL` **is** set but Redis can't be reached at boot, the server
crashes on startup rather than silently degrading to in-memory — the whole point of setting
`REDIS_URL` is a persistence guarantee, so failing loudly beats pretending it's working.
Sessions carry a 6-hour sliding TTL (refreshed on every `/session/resume`), so an actively
used session won't expire out from under a connected user, but a genuinely abandoned one
self-cleans instead of accumulating in Redis forever.

Install with `sudo apt install redis-server` (ships and auto-enables its own systemd unit —
verified working on this box). Binds to `127.0.0.1:6379` by default, no auth needed for a
single-user localhost-only setup.

```
REDIS_URL=redis://127.0.0.1:6379
```

**Conversational memory** (`agent/memory/`): reuses the same `REDIS_URL` and
`ANTHROPIC_API_KEY` above — no new env vars. Facts about a user are stored under a
`livekit-voice-skeleton:memory:{userId}` key with a 180-day sliding TTL (longer than
sessions' 6h, since memory is meant to outlast any one session) and injected into the system
prompt on their next session. Same `REDIS_URL`-unset-vs-unreachable behavior as session
persistence above.

**Fallback vendor** (STT/TTS failover, `agent/pipeline/failover.js`) — **not yet built**.
OpenAI was considered and dropped; the fallback vendor for STT/TTS is TBD (LLM fallback stays
Anthropic-only regardless — a cheaper/faster model, since Anthropic has no STT/TTS product).
No env var needed until a vendor is picked and this is implemented.

## Tuning / manual overrides

`BARGE_IN_LEVEL_THRESHOLD` tunes how sensitive server-side barge-in detection is (RMS scale,
roughly 0-1; higher = requires louder speech to interrupt). The `FORCE_FALLBACK_*` vars let
you manually force a pipeline stage onto its fallback vendor to demonstrate failover on
command, without waiting for a real vendor outage — set to any non-empty value to force.

```
BARGE_IN_LEVEL_THRESHOLD=0.02
FORCE_FALLBACK_STT=
FORCE_FALLBACK_LLM=
FORCE_FALLBACK_TTS=
```

Never commit the real `.env` — it's gitignored.
