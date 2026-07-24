// Anthropic Claude LLM adapter. API verified directly against the installed
// @anthropic-ai/sdk@0.114.0 source (lib/MessageStream.d.ts) rather than assumed from docs.
//
// MessageStream has a built-in `.abort()` method (backed by its own public `.controller`
// AbortController) — this is the barge-in cancellation hook, no manual AbortController
// wiring needed.
import Anthropic, { APIUserAbortError } from "@anthropic-ai/sdk";

export function createClaudeLLM({
  apiKey,
  model = "claude-sonnet-5",
  maxTokens = 1024,
  createClient = (opts) => new Anthropic(opts),
} = {}) {
  const client = createClient({ apiKey });

  // Returns the in-flight MessageStream so the caller (agentSession.js) can hold onto it
  // and call .abort() if a barge-in happens before it settles.
  function generate({ messages, system, onToken, onError }) {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    });
    stream.on("text", (delta) => onToken?.(delta));
    stream.on("error", (err) => {
      if (err instanceof APIUserAbortError) return; // expected on barge-in, not a real error
      onError?.(err);
    });
    return stream;
  }

  // One-shot, non-streaming call — used for end-of-session memory extraction
  // (agent/memory/memoryExtractor.js), not the turn-by-turn conversation. Reuses this same
  // client/API key rather than instantiating a second Anthropic client.
  async function summarize({ system, prompt, maxTokens = 300 }) {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].text;
  }

  return { generate, summarize };
}
