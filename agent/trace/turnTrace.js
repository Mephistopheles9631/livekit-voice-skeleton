// Lightweight per-turn latency trace: one structured JSON line per turn to stdout (->
// journald via systemd, greppable/jq-able), no tracing infra. Uses process.hrtime.bigint()
// for sub-ms precision.
//
// Honesty note (see PROJECT_SPEC.md Phase 4): this process can't observe the literal
// microphone or speaker. "speech_started" is really "Deepgram's VAD detected speech began,"
// not a hardware mic timestamp, and "tts_first_frame_captured" is "first synthesized frame
// handed to AudioSource," not physical speaker output. The round-trip number this produces
// measures agent-process boundaries, not true end-to-end mic-to-speaker latency.
export function createTurnTrace(turnId, roomName) {
  const marks = [];

  function mark(name) {
    marks.push({ name, ts: process.hrtime.bigint() });
  }

  function finish(extra = {}) {
    if (marks.length === 0) return;
    const first = marks[0].ts;
    const fromStartMs = {};
    for (const m of marks) {
      fromStartMs[m.name] = Number(m.ts - first) / 1e6;
    }
    const totalMs = Number(marks[marks.length - 1].ts - first) / 1e6;
    console.log(
      JSON.stringify({
        event: "turn_trace",
        turnId,
        roomName,
        totalMs,
        marksFromStartMs: fromStartMs,
        ...extra,
      })
    );
  }

  return { mark, finish };
}
