# wemock

Record real API calls in Chrome DevTools, then replay them as switchable mock scenarios.

## What this is

A Chrome DevTools panel for front-end developers. It shows your page's API calls, turns any
of them into a mock with one click, and serves those mocks back to the page. Group mocks into
**scenarios** ("empty list", "500 error", "slow") and switch between them in one click, so
you can test the states your backend rarely gives you.

- **Record, then replay.** "Mock this" on a logged call, or "Save as scenario" on a whole
  filtered list. A call to another site keeps its host in the mock, so it matches only that
  site. The Log names the mock that answered each call, with a link to it, and filters by type,
  method and status. Save the Log as a HAR file to share a session.
- **Import.** A HAR file from DevTools' Network tab ("Save all as HAR"), an OpenAPI 3 or
  Swagger 2 file (JSON or YAML), or Mokku's files. Import asks whether to add to your mocks or
  replace them.
- **Scenarios.** A project's Default scenario always applies; the active one overrides it.
  Select, duplicate, delete or clear scenarios, with Undo; duplicate a mock; export one scenario
  to share it. A filter box and fold arrows keep long lists short.
- **URL patterns.** `/api/goals/:id`, wildcards (`/files/*rest`), optional host
  (`https://api.example.com/x`), and GraphQL operation names.
- **Conditions.** "Match only when" a query parameter, a request header or fields of a JSON
  body have given values (`*` for "present"). Mocks with conditions are tried first.
- **Any status from 200 to 599**, headers, a delay, and text or **binary** bodies (images,
  PDFs, downloads).
- **Templates.** A body can say `{{params.id}}`, `{{query.page}}`, `{{headers.x-user}}`,
  `{{body.user.name}}`, `{{uuid}}`, `{{now}}` or `{{timestamp}}`, filled in per call.
- **Sequences.** Each call to a mock gets the next reply: "pending, pending, done". The count
  starts over when the page reloads.
- **Code replies.** A mock can answer with a few lines of JavaScript that read the call's
  URL parameters, query, body and headers, and set the status. `/doc/:id` with
  `return { id: params.id }` answers each document by its id. `req.callCount` counts the calls.
- **WebSocket and SignalR mocks.** A socket mock answers a WebSocket URL with no server:
  messages on a timeline after connecting, and replies to what the client sends, fixed or from
  code. For SignalR hubs (JSON protocol) wemock also answers `negotiate`, the handshake and the
  pings, so `HubConnection.start()`, `on(...)`, `invoke(...)` and `stream(...)` work as with a real
  hub, errors included.
  Real sockets appear in the log with their messages; **Mock this socket** turns one
  connection into a socket mock, with the server's messages and its timing.
- **Test bar.** Type a URL (and request headers, if you like) in the Mocks tab to see which
  mock answers and what it returns, without reloading the page.
- **Console line.** Each mocked call writes one line to the page's Console, such as
  `[wemock] GET /doc/1 → 200 mock "Doc one" (12 ms)`. A switch in the panel turns it off.
- **`fetch`, `XMLHttpRequest` and libraries built on them** (axios included).
- **Keyboard.** Every row, button and field works from the keyboard.
- **Checked on real apps.** React (fetch), axios (XHR, interceptors), Angular `HttpClient` and a
  real ASP.NET Core SignalR hub are part of the tests.

Your data stays in your browser (`chrome.storage.local`). wemock sends nothing anywhere.

## Use it

wemock is not on the Chrome Web Store yet. The easiest way in: download the zip from the
[latest release](https://github.com/Ank-KhoaHo/wemock/releases/latest), unzip it, open
`chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick the
unzipped folder.

Or run it from source:

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

- Calls made by Service Workers and Server-Sent Events are not seen.
- A real socket logs at most 200 messages. "Mock this socket" replays a plain socket's
  messages on a timeline; it cannot tell which message answered which.
- SignalR mocks speak the JSON hub protocol only, not MessagePack.
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

Version 1.5.0, before its first Store release. Licensed under MIT; see [LICENSE](LICENSE).
