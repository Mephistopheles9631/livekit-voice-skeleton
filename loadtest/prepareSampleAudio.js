// One-time prep script — NOT part of the automated run path. Synthesizes the fixed real-
// speech clips used by loadtest/simulateSession.js (Part 1) and loadtest/verifyMemory.js
// (Part 2) via the project's real ElevenLabs adapter, and writes them as raw PCM16/16kHz/mono
// to loadtest/sample-audio/. Real synthesized speech, not silence or a tone — Deepgram needs
// actual signal — but it IS synthetic (TTS-generated), not a human recording; see
// loadtest/README.md's honesty note. Re-run this manually only if the clips need regenerating
// (e.g. a different voice/model); the committed .pcm files are otherwise reused as-is.
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElevenLabsTTS } from "../agent/pipeline/tts/elevenLabsAdapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "sample-audio");
const SAMPLE_RATE = 16000;

const CLIPS = [
  { file: "generic-turn.pcm", text: "Hey, can you give me a quick update on today's weather?" },
  { file: "state-fact.pcm", text: "Hi, my name is Alex, and I prefer short answers." },
  { file: "ask-name.pcm", text: "What's my name?" },
];

// createElevenLabsTTS()'s flush() forces generation of buffered text but does NOT itself
// produce a final isFinal message on this account/model — ElevenLabs' streaming-input socket
// just idles afterward and self-closes after a 20s no-input timeout (confirmed live: hit that
// exact error on the first attempt). Rather than rely on isFinal (or change the shared
// adapter used by the real pipeline), this detects completion via a quiet period with no new
// audio chunks, then closes the socket itself via stop().
const QUIET_PERIOD_MS = 1500;
const MAX_WAIT_MS = 20000;

function synthesizeToPcm(text) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let quietTimer = null;
    let maxTimer = null;

    const tts = createElevenLabsTTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      model: process.env.ELEVENLABS_MODEL,
      sampleRate: SAMPLE_RATE,
      onAudioChunk: (buf) => {
        chunks.push(buf);
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, QUIET_PERIOD_MS);
      },
      onError: (err) => {
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        reject(err);
      },
    });

    function finish() {
      clearTimeout(maxTimer);
      tts.stop();
      resolve(Buffer.concat(chunks));
    }

    maxTimer = setTimeout(finish, MAX_WAIT_MS);
    tts.sendText(text);
    tts.flush();
  });
}

for (const { file, text } of CLIPS) {
  process.stdout.write(`Synthesizing "${text}" -> ${file} ... `);
  const pcm = await synthesizeToPcm(text);
  await writeFile(path.join(OUT_DIR, file), pcm);
  console.log(`${(pcm.length / 1024).toFixed(1)} KB`);
}

console.log("Done.");
