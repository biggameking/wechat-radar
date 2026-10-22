# Live Signals: abort during the first poll leaves a background interval

## Finding

P2, bounded cancellation/resource-lifecycle defect. Baseline main: `79547dd7416001fd24b934a46f46920a61a93011`.

`app/signals/page.tsx` opens `/api/new-messages` using an AbortController. Pausing or leaving the page aborts that request. The route originally registered its abort listener only after awaiting the first `wxNewMessages` / `wxSessions` poll. Cancellation during that await was missed, and an interval was subsequently created for the abandoned request.

No real WeChat account, messages, CLI process, daemon, or database was used in this evaluation. This finding is not evidence of a real chat disclosure incident.

## Repair

- Register cancellation before starting asynchronous work and handle an already-aborted request.
- Make stopping idempotent and close the stream once.
- Do not enqueue late results after stopping.
- Do not create an interval when the initial poll finishes after cancellation.

Already-running wx calls are not forcibly terminated. The repair prevents later polling and late delivery; it does not add cancellation support to wx-cli itself. The separate stream-reader cancellation path and deployed Next.js disconnect propagation still require integration verification. Long-running polls overlapping each other are outside this repair.

## Executed checks

Node 24.19.0 with TypeScript 5.7.3 transpilation. The regression executes the actual route function with native Request, Response, ReadableStream, AbortController and timers; only wx calls are replaced by empty synthetic responses. The native observation uses the route's 2-second interval and waits 2.1 seconds. Test-created intervals are always cleared in cleanup.

| Cancellation point | Baseline active intervals | Patched active intervals |
| --- | ---: | ---: |
| Before handler entry | 1 | 0 |
| During initial pending poll | 1 | 0 |
| After normal initialization | 0 | 0 |

During the initial-poll cancellation test, baseline wx-call count increased from 2 to 4 during the native observation window. Patched call count stayed at 2. For an already-aborted patched request, no wx calls started. Six baseline/patched cases passed their respective assertions. The test script also passed `node --check`.

Run from the repository with its development dependencies installed:

```sh
node scripts/test-new-messages-abort.cjs --native-polling
```

To demonstrate the pre-fix behavior, pass a separately saved baseline route path and `--expect-baseline --native-polling`. Never point the test at personal data or invoke the wx CLI.

Not run: full Next.js build/lint, production server, browser pause/navigation integration, real wx-cli, or macOS. Before merging, exercise pause and navigation while the initial read is slow in the normal local runtime, then verify subsequent normal live sessions still poll. No deployment or merge is implied by this source-level repair.
