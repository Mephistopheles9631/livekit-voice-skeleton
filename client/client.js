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

const statusEl = document.getElementById("status");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const vadIndicator = document.getElementById("vad-indicator");
const remoteAudioContainer = document.getElementById("remote-audio-container");

const SERVER_URL = "";

let room = null;
let localAudioTrack = null;
let audioContext = null;
let vadRafId = null;

function log(msg) {
  statusEl.textContent += `\n${msg}`;
  console.log(msg);
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
// let the AI respond vs. wait vs. interrupt. This is a deliberately simple
// amplitude-threshold VAD — a real implementation would use something like
// WebRTC's built-in audio level events or a dedicated VAD model
// (e.g. Silero VAD) for robustness in noisy conditions.
function startVAD(mediaStreamTrack) {
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(
    new MediaStream([mediaStreamTrack])
  );
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  const SPEAKING_THRESHOLD = 15; // tune against real mic input

  function tick() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const speaking = avg > SPEAKING_THRESHOLD;
    vadIndicator.classList.toggle("speaking", speaking);
    vadRafId = requestAnimationFrame(tick);
  }
  tick();
}

function stopVAD() {
  if (vadRafId) cancelAnimationFrame(vadRafId);
  if (audioContext) audioContext.close();
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

  startVAD(localAudioTrack.mediaStreamTrack);

  leaveBtn.disabled = false;
}

async function leave() {
  stopVAD();
  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack = null;
  }
  if (room) {
    await room.disconnect();
    room = null;
  }
  remoteAudioContainer.innerHTML = "";
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
}

joinBtn.addEventListener("click", () => join().catch((e) => log(`Error: ${e.message}`)));
leaveBtn.addEventListener("click", () => leave().catch((e) => log(`Error: ${e.message}`)));
