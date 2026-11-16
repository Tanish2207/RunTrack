# 018 — Cloud Function `generateWorkoutSummary`

> **Milestone:** M5 · **Labels:** `cloud-functions`, `ai`, `security` · **Depends on:** #003 · **Size:** M

## Summary

Spec §3.6: the LLM call lives **only** server-side. Build the HTTPS-callable Cloud Function
that takes the finished activity's stats + the user's last ~5 activities, prompts an LLM
(Anthropic API), and returns a short encouraging recap. Key stored via
`firebase functions:secrets:set` — never in the client.

## Tasks

- [ ] `firebase init functions` (TypeScript, Node 20) → `functions/` at repo root; wire `firebase.json`.
- [ ] `functions/src/index.ts` exports `generateWorkoutSummary = onCall({ region: 'us-central1', timeoutSeconds: 30, memory: '256MB' }, handler)`.
- [ ] Input contract (validate everything, reject with `HttpsError('invalid-argument')` otherwise):
  ```ts
  { uid: string,                       // must equal context.auth.uid
    activity: { type, distanceKm, durationSec, avgPaceSecPerKm, caloriesEstimate, startTimeMs },
    recent: Array<{ type, distanceKm, durationSec, avgPaceSecPerKm, startTimeMs }>  // ≤ 5
  }
  ```
  `if (!context.auth) throw new HttpsError('unauthenticated', ...)`; `if (data.uid !== context.auth.uid) throw new HttpsError('permission-denied', ...)`.
- [ ] Prompt build (deterministic, compact): "You are RunTrack Coach. Write ONE short encouraging recap (max 25 words) for this {type}. Stats: {distance} km in {duration} at {pace} /km, {kcal} kcal. Context: last {n} activities — {best/avg distance, trend}. Compare briefly if useful. No emojis, no greetings."
- [ ] Anthropic call:
  ```ts
  fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 120, messages: [{ role: 'user', content: prompt }] }) });
  ```
  `ANTHROPIC_API_KEY` from `defineSecret('ANTHROPIC_API_KEY')`; set once via `firebase functions:secrets:set ANTHROPIC_API_KEY`.
- [ ] Response: strip whitespace/quotes, return `{ summary: text }`. Failure paths → `HttpsError('unavailable', ...)` (client treats all errors as "skip silently").
- [ ] Emulator smoke test: `firebase emulators:start --only functions` (secrets unavailable locally — fall back to a stubbed LLM response behind an env flag for emulator testing; note in file). Then deploy and test the real function once.

## Acceptance Criteria

- [ ] Callable deployed; calling from the app with valid data returns a 1–2 sentence recap referencing the actual stats (e.g. "Solid 5K today…").
- [ ] Unauthenticated / uid-mismatch calls are rejected.
- [ ] API key exists only in Secret Manager (grep the repo — no key in any committed file).
- [ ] Latency: p50 under ~8s, function timeout 30s hard cap.
- [ ] LLM outage/API error produces a clean `HttpsError('unavailable')`, not a 500 stack.

## Implementation Notes

- `claude-3-5-haiku-latest` is chosen for cost/latency on a 25-word output; swap model via one constant.
- Keep the function stateless: it does **not** read Firestore — the client supplies recent-activity context (simpler + matches spec §3.6's "client calls with the just-completed stats plus last ~5").
- Log prompt+response length only (no PII beyond stats) for debugging.
