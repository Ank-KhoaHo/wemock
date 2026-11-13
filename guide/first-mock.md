# Your first mock

## Read the Log

Open your app, then the **wemock** tab in DevTools. Every `fetch` and `XMLHttpRequest` call the
page makes appears in the **Log**, with its method, path, status and time. The last column says
who answered:

| Badge | Meaning |
|---|---|
| `real` | the server answered |
| `MOCK` | a wemock mock answered; the details say which one, with a link to it |
| `LATE` | the call came before wemock had loaded its mocks, waited up to 200 ms, then went to the server |

Click a row to see its headers and body. The chips above the Log filter by type (`MOCK`, `real`,
`LATE`, `WS`), by method and by status (`2xx` … `5xx`). The filter box matches the URL.

- **Rec** (top right) pauses recording: no new rows.
- The power button turns mocking off: every call goes to the server, until you turn it on again.

## Mock one call

1. Click a call in the Log.
2. Click **Mock this**.
3. Reload the page.

The same call now gets the recorded answer, marked `MOCK`. The new mock is in the **Mocks** tab,
in the active scenario, ready to edit.

A call to another site keeps its host, for example `https://api.example.com/users`. That mock
answers only that site, never a same-named path on another one.

## Mock many calls

- **Save as scenario** turns every call in the (filtered) Log into one new scenario. Filter to
  `/api/`, save it as "Happy path", and you have a snapshot of your backend.
- **Mock selected (next release):** tick the rows you want, then **Mock selected**.

## Mock a socket

Real WebSocket connections appear in the Log too, with their messages. Click one, then **Mock
this socket**. See [WebSocket and SignalR](sockets.md).

## Share a session

**Save HAR** writes the Log to a HAR file, which DevTools, wemock and most tools can read.

← [Install](install.md) · Next: [Scenarios](scenarios.md) →
