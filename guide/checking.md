# Checking your mocks

## The Test bar

At the top of the Mocks tab. Pick a method, type a URL (`/api/products/42` or a full URL), add
request headers or a body if your mock has conditions, and click **Test**. wemock shows:

- which mock answers, and from which scenario; click its name to open it;
- the status, the headers and the body it returns;
- for a code mock, the result of really running the code, or its error;
- for a binary body, its size and type;
- "No mock — the real server answers" when nothing matches.

Nothing reloads, and nothing is sent to your server.

## The Console line

Each mocked call writes one line to the page's Console:

```
[wemock] GET /doc/1 → 200 mock "Doc one" (12 ms)
```

The **Console** button at the top of the panel switches it off and on.

## The Log

Mocked calls never reach the network, so DevTools' Network tab does not show them. The wemock
Log does, marked `MOCK`, with the name of the mock that answered. See
[Your first mock](first-mock.md).

← [WebSocket and SignalR](sockets.md) · Next: [Import and export](import-export.md) →
