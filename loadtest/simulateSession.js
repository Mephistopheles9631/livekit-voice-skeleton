// Part 1: one simulated client session — joins like a real client, then runs `turns` rounds
// of publish-a-clip -> wait-for-response, timestamping each. See
// SCOPE_OF_WORK_sugarshan_poc.md Part 1 for the exact measurement definition.
import { readFile } from "node:fs/promises";
import { connectSimulatedClient } from "./lib/liveClient.js";

const TURN_TIMEOUT_MS = 20000;

// Between turns, actively wait for the agent's voice track to actually go quiet rather than
// guessing a fixed delay. A fixed 500ms gap was tried first and looked fine at low concurrency,
// but a real 10-session run exposed it as unreliable: under contention, a prior turn's trailing
// audio can still be draining well past 500ms after the pipeline itself reports the turn done
// (broadcast "assistant" {event:"end"}), so the next turn's frame-detector was catching stale
// leftover audio from the PREVIOUS response, not a fresh one — visible as a clear, reproducible
// pattern in the raw results (every session's turn 0 measured a plausible multi-second
// round-trip; turns 1/2 almost always measured single-digit milliseconds). Same quiet-period
// technique used in prepareSampleAudio.js to detect ElevenLabs synthesis completion.
const QUIET_MS = 700;
const QUIET_MAX_WAIT_MS = 5000;

function waitForQuiet(client) {
  return new Promise((resolve) => {
    let timer = setTimeout(resolve, QUIET_MS);
    const giveUp = setTimeout(() => {
      clearTimeout(timer);
      resolve();
    }, QUIET_MAX_WAIT_MS);
    client.setOnAgentFrame(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        clearTimeout(giveUp);
        resolve();
      }, QUIET_MS);
    });
  });
}

function runOneTurn(client, clipBuffer, { sessionIndex, turnIndex }) {
  return new Promise((resolve) => {
    let t0, t1, tFrame;
    let settled = false;
    let timeoutHandle;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve({
        sessionIndex,
        turnIndex,
        roundTripMs: tFrame !== undefined ? tFrame - t0 : null,
        transcriptLatencyMs: t1 !== undefined ? t1 - t0 : null,
        error: error ? (error.message ?? String(error)) : undefined,
      });
    };

    client.onTranscript((msg, ts) => {
      if (msg.isFinal && t1 === undefined) t1 = ts;
    });
    client.setOnAgentFrame((ts) => {
      if (tFrame === undefined) tFrame = ts;
    });
    client.onAssistant((msg) => {
      if (msg.event === "end") finish();
      else if (msg.event === "error") finish(new Error(`pipeline error: ${msg.message}`));
    });

    timeoutHandle = setTimeout(() => finish(new Error("turn timed out")), TURN_TIMEOUT_MS);

    t0 = performance.now();
    client.publishClip(clipBuffer).catch(finish);
  });
}

export async function runSimulatedSession({ index, turns, serverUrl, clipPath }) {
  const clipBuffer = await readFile(clipPath);
  const userId = `loadtest-${index}-${Date.now()}`;
  const client = await connectSimulatedClient({ serverUrl, userId });

  const results = [];
  try {
    for (let turnIndex = 0; turnIndex < turns; turnIndex++) {
      const result = await runOneTurn(client, clipBuffer, { sessionIndex: index, turnIndex });
      results.push(result);
      if (turnIndex < turns - 1) await waitForQuiet(client);
    }
  } finally {
    await client.disconnect().catch(() => {});
  }
  return results;
}
