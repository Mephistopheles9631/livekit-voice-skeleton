// Real-time voice client skeleton.
//
// This is the piece that maps to the job's "Real-time Voice Pipeline" and
// "Session Lifecycle Management" bullets: joining/leaving a live session,
// publishing local mic audio, subscribing to remote audio, and a basic
// voice-activity detector as the seed of real turn-taking/barge-in logic.
//
// NOTE: uses the LiveKit client SDK via CDN (esm.sh) so this file can be
// opened directly without a bundler step, for skeleton purposes. A real
// product build would use the npm package + a proper bundler.

import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
} from "https://esm.sh/livekit-client@2.9.2";
import { startVAD } from "./vad.js";

const statusEl = document.getElementById("status");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const vadIndicator = document.getElementById("vad-indicator");
const remoteAudioContainer = document.getElementById("remote-audio-container");
const transcriptPanel = document.getElementById("transcript-panel");
const interimEl = transcriptPanel.querySelector(".interim");
const assistantPanel = document.getElementById("assistant-panel");

const SERVER_URL = "";

let room = null;
let localAudioTrack = null;
let vadInstance = null;

function log(msg) {
  statusEl.textContent += `\n${msg}`;
  console.log(msg);
}

// --- Phase 2: live transcript panel ---
// Transcripts arrive over LiveKit's own data channel (topic "transcript") from the agent
// process — see agent/agentSession.js's broadcastTranscript() and
// agent/pipeline/stt/deepgramAdapter.js's onTranscript payload shape.
function renderTranscript({ text, isFinal }) {
  if (isFinal) {
    const line = document.createElement("p");
    line.className = "final";
    line.textContent = text;
    transcriptPanel.insertBefore(line, interimEl);
    interimEl.textContent = "";
  } else {
    interimEl.textContent = text;
  }
}

// --- Phase 3/4: streamed assistant response panel ---
// Payload shape from agent/agentSession.js's broadcast("assistant", ...): {event: "start"},
// {event: "delta", text}, {event: "end", interrupted}, {event: "error", message}.
function renderAssistantEvent(msg) {
  if (msg.event === "start") {
    assistantPanel.textContent = "";
    assistantPanel.classList.remove("interrupted");
  } else if (msg.event === "delta") {
    assistantPanel.textContent += msg.text;
  } else if (msg.event === "error") {
    log(`Pipeline error: ${msg.message}`);
  } else if (msg.event === "end") {
    assistantPanel.classList.toggle("interrupted", Boolean(msg.interrupted));
    if (msg.interrupted) log("Assistant response interrupted (barge-in).");
  }
}

function handleDataReceived(payload, _participant, _kind, topic) {
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload));
    if (topic === "transcript") renderTranscript(msg);
    else if (topic === "assistant") renderAssistantEvent(msg);
  } catch (e) {
    log(`Failed to parse data-channel payload (topic=${topic}): ${e.message}`);
  }
}

async function fetchToken(userId) {
  const res = await fetch(`${SERVER_URL}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return res.json();
}

// --- Voice Activity Detection (VAD) ---
// A real "turn-taking" system needs to know, moment to moment, whether the
// user is currently speaking, so the orchestration layer can decide when to
// let the AI respond vs. wait vs. interrupt. Phase 1: real Silero VAD (see
// vad.js) replacing the original amplitude-threshold placeholder — this runs
// its own independent mic capture (via vad-web's default getStream), separate
// from the LiveKit-published track, rather than sharing a MediaStream, since
// vad-web's pause()/destroy() stop whatever stream they're given and that
// would risk killing the LiveKit publish track too.
async function startLocalVAD() {
  vadInstance = await startVAD({
    onSpeechStart: () => {
      vadIndicator.classList.add("speaking");
      log("VAD: speech start");
    },
    onSpeechEnd: () => {
      vadIndicator.classList.remove("speaking");
      log("VAD: speech end");
    },
    onMisfire: () => {
      vadIndicator.classList.remove("speaking");
      log("VAD: misfire (too short to count as speech)");
    },
  });
}

async function stopLocalVAD() {
  if (vadInstance) {
    await vadInstance.destroy();
    vadInstance = null;
  }
  vadIndicator.classList.remove("speaking");
}

async function join() {
  joinBtn.disabled = true;
  statusEl.textContent = "Requesting token...";

  const userId = `user-${Math.floor(Math.random() * 100000)}`;
  const { token, url, roomName } = await fetchToken(userId);
  log(`Got token for room: ${roomName}`);

  room = new Room();

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    log(`Subscribed to ${track.kind} track from ${participant.identity}`);
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      remoteAudioContainer.appendChild(el);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
  });

  room.on(RoomEvent.DataReceived, handleDataReceived);

  room.on(RoomEvent.Disconnected, () => {
    log("Disconnected from room.");
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
  });

  await room.connect(url, token);
  log(`Connected to room as ${userId}`);

  localAudioTrack = await createLocalAudioTrack();
  await room.localParticipant.publishTrack(localAudioTrack);
  log("Published local mic audio track.");

  await startLocalVAD();

  leaveBtn.disabled = false;
}

async function leave() {
  await stopLocalVAD();
  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack = null;
  }
  if (room) {
    await room.disconnect();
    room = null;
  }
  remoteAudioContainer.innerHTML = "";
  transcriptPanel.querySelectorAll(".final").forEach((el) => el.remove());
  interimEl.textContent = "";
  assistantPanel.textContent = "";
  assistantPanel.classList.remove("interrupted");
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
}

joinBtn.addEventListener("click", () => join().catch((e) => log(`Error: ${e.message}`)));
leaveBtn.addEventListener("click", () => leave().catch((e) => log(`Error: ${e.message}`)));
