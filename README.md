# wemock

Record real API calls in Chrome DevTools, then replay them as switchable mock scenarios.

## What this is

A Chrome DevTools panel for front-end developers. It shows your page's API calls, turns any
of them into a mock with one click, and serves those mocks back to the page. Group mocks into
**scenarios** ("empty list", "500 error", "slow") and switch between them in one click, so
you can test the states your backend rarely gives you.

- **Record, then replay.** "Mock this" on a logged call, or "Save as scenario" on a whole
  filtered list.
- **Scenarios.** A project's Default scenario always applies; the active one overrides it.
- **URL patterns.** `/api/goals/:id`, wildcards (`/files/*rest`), optional host
  (`https://api.example.com/x`), and GraphQL operation names.
- **Any status from 200 to 599**, headers, a delay, and text or **binary** bodies (images,
  PDFs, downloads).
- **Code replies.** A mock can answer with a few lines of JavaScript that read the call's
  URL parameters, query, body and headers, and set the status. `/doc/:id` with
  `return { id: params.id }` answers each document by its id.
- **Test bar.** Type a URL in the Mocks tab to see which mock answers and what it returns,
  without reloading the page.
- **Console line.** Each mocked call writes one line to the page's Console, such as
  `[wemock] GET /doc/1 → 200 mock "Doc one" (12 ms)`. A switch in the panel turns it off.
- **`fetch`, `XMLHttpRequest` and libraries built on them** (axios included).
- **Import from Mokku.** Its 2.x export, 1.x storage and mock-file formats all import,
  function mocks included.

Your data stays in your browser (`chrome.storage.local`). wemock sends nothing anywhere.

## Use it

wemock is not on the Chrome Web Store yet. To run it from source:

```
npm ci
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and
pick `.output/chrome-mv3`.

1. Open your app. On `localhost` wemock is always on; on any other site, click the wemock
   toolbar icon, switch it on for that site, and reload the page.
2. Open DevTools and the **wemock** tab. Calls appear in the log as the page makes them.
3. Click a call, then **Mock this**. Reload: that call is now served by wemock (badge
   `MOCK`).
4. Edit the mock in the **Mocks** tab, or make a new scenario and switch to it from the chips
   at the top.

## Limits

- Calls made by Service Workers, WebSockets and Server-Sent Events are not seen.
- Mocked calls do not appear in DevTools' Network tab: they never leave the page. Use the
  wemock log or the Console line.
- Code replies run in a sandboxed extension page with no access to the page or to wemock,
  and stop after 1 second. Code that fails answers status 500 with its error message.
- A call made before wemock has loaded its mocks waits up to 200 ms, then goes through and is
  marked `LATE`.
- Only Chrome (and Chromium browsers) for now.

## Where things live

| File | What it holds |
|---|---|
| [PUBLIC.md](PUBLIC.md) | why some material is deliberately not published here |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to build and test it, and what gets rejected |
| [SECURITY.md](SECURITY.md) | how to report a vulnerability, and what is not one |
| [ROADMAP.md](ROADMAP.md) | direction, and the things deliberately not coming |
| [LICENSE](LICENSE) | what you may do with this |

## Status

Version 1.1.0, before its first Store release. Licensed under MIT; see [LICENSE](LICENSE).
