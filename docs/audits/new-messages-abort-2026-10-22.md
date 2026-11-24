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
- Stop polling and remove the request listener when the response reader cancels.

Already-running wx calls can finish in the background. The route discards their results and starts no further poll once stopped.

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
node scripts/test-new-messages-abort.mjs --native-polling
```

To demonstrate the pre-fix behavior, pass a separately saved baseline route path and `--expect-baseline --native-polling`. Never point the test at personal data or invoke the wx CLI.

## Local integration acceptance

On macOS arm64, Node 24.22.1 and the locked Next.js 16.2.6 passed the production build and repository lint. The native regression passed all five cancellation cases. The two additional cases cancel the response reader during the first read and after the recurring timer starts. Both retained zero timers. The previously submitted candidate retained an interval when the active reader canceled.

Chromium connected to the production build on loopback. A synthetic `wx` executable on the server's test-only PATH delayed `new-messages` until released and counted calls. Pausing during the first request and navigating to the groups page during a separate first request both left the call count unchanged for six seconds after release. A fresh session received a fixture message and polled again; its call count remained unchanged for six seconds after pausing. The repeat with the locked SQLite binding available also confirmed HTTP 200 for the sidebar stats.

To repeat: install the frozen lockfile dependencies, build the existing `better-sqlite3` native binding as described in the README, and run `npm run build` then `npm run start -- --hostname 127.0.0.1`. Set `WECHAT_RADAR_DATA_DIR` to a disposable directory and put a synthetic `wx` executable first in PATH. Have it count and hold `new-messages` calls and return synthetic JSON for session reads. In `/signals`, pause or navigate away before releasing the first read. Observe the call count for longer than the five-second interval. Then reopen the page and observe a normal recurring poll.

The acceptance covers local Next.js and Chromium with synthetic messages. Deployment-specific proxy behavior and overlap between slow polls remain outside this change.
