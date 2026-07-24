// Pure state machine for one room-session's conversational turn cycle. Phase 2 only ever
// reaches LISTENING (the agent joins and starts transcribing); THINKING/SPEAKING and the
// barge-in transition (SPEAKING -> LISTENING) are exercised starting Phase 3/4 — see
// PROJECT_SPEC.md for the full design this exists to support.
export const STATES = Object.freeze({
  IDLE: "IDLE",
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
});

const TRANSITIONS = {
  [STATES.IDLE]: [STATES.LISTENING],
  [STATES.LISTENING]: [STATES.THINKING, STATES.IDLE],
  [STATES.THINKING]: [STATES.SPEAKING, STATES.LISTENING, STATES.IDLE],
  [STATES.SPEAKING]: [STATES.LISTENING, STATES.IDLE],
};

export function createTurnState(initial = STATES.IDLE) {
  let current = initial;
  const listeners = new Set();

  function transition(next) {
    const allowed = TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`invalid turn-state transition: ${current} -> ${next}`);
    }
    const prev = current;
    current = next;
    for (const listener of listeners) listener(next, prev);
    return current;
  }

  return {
    get: () => current,
    transition,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
