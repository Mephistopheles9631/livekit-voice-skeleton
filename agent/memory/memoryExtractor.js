// End-of-session memory extraction: turns a completed session's conversation history into an
// updated, compact summary of durable facts about the user — called once per session (from
// agentSession.js's leave()), not per turn. Uses claudeAdapter.js's summarize() (a one-shot,
// non-streaming call reusing the session's already-authenticated Anthropic client) rather
// than the turn-by-turn generate().
// The transcript is wrapped in <transcript> tags and the prompt ends by re-stating the task
// (rather than ending right after the transcript's last line) — an earlier version of this
// prompt ended with raw "User: ...\nAssistant: ..." lines and nothing after them, which in
// testing against the real API caused Claude to sometimes *continue* the dialogue (inventing
// further turns that were never said) instead of summarizing it. Reproduced and fixed by
// making it unambiguous the transcript is quoted data to analyze, not a chat to continue.
const SYSTEM_PROMPT =
  "You are a memory-extraction step for a voice AI system, not a conversational participant. " +
  "You will be given a user's previously remembered facts (if any) and a transcript of one " +
  "conversation, wrapped in <transcript> tags. Extract an updated bullet list of durable " +
  "facts about the user worth remembering next time — name, stated preferences, ongoing " +
  "topics, corrections to prior facts. Merge and update rather than just appending: if this " +
  "conversation contradicts an old fact, keep only the corrected version. Use ONLY what is " +
  "explicitly stated in the transcript — never invent, assume, or continue it. If nothing in " +
  "the transcript is worth remembering, output the previous facts unchanged. Keep the whole " +
  "list under 150 words. Output ONLY the bullet list, nothing else — no preamble, no " +
  "commentary, no closing remarks.";

function formatTranscript(history) {
  return history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
}

export async function extractMemory({ llm, history, previousFacts }) {
  const prompt =
    `Previously remembered facts:\n${previousFacts || "None yet."}\n\n` +
    `<transcript>\n${formatTranscript(history)}\n</transcript>\n\n` +
    `Output the updated bullet list of facts now.`;

  return llm.summarize({ system: SYSTEM_PROMPT, prompt });
}
