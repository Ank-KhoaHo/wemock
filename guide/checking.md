# Checking your mocks

## Answered by

Click a call marked `MOCK` in the Log. **Answered by** names the mock and its scenario; click the
name to open that mock. A call marked `real` reached your server.

The status, the headers and the body the page got are under it.

## The Console line

Each mocked call writes one line to the page's Console:

```
[wemock] GET /doc/1 → 200 mock "Doc one" (12 ms)
```

The **Console** button at the top right of the panel switches it off and on.

## The Log

Mocked calls never reach the network, so DevTools' Network tab does not show them. The wemock
Log does, marked `MOCK`, with the name of the mock that answered. See
[Your first mock](first-mock.md).

← [WebSocket and SignalR](sockets.md) · Next: [Import and export](import-export.md) →
