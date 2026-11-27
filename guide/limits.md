# Limits

What wemock cannot do today, so you know before you rely on it.

## Calls

- Calls made by Service Workers and Web Workers are not seen. Calls from the page and from its
  iframes on the same site are.
- Server-Sent Events can be mocked, but real ones are not logged.
- Mocked calls do not appear in DevTools' Network tab: they never leave the page. Use the wemock
  [Log](checking.md#the-log) or the [Console line](checking.md#the-console-line).
- A call made before wemock has loaded its mocks waits up to 200 ms, then goes through and is
  marked `LATE`.

## Code replies

- Code runs in a sandboxed extension page with no access to the page or to wemock, and stops
  after 1 second. Code that fails answers status 500 with its error message.

## Sockets

- A real socket logs at most 200 messages.
- "Mock this socket" replays a plain socket's messages on a timeline; it cannot tell which
  message answered which.
- SignalR mocks speak the JSON hub protocol only, not MessagePack.

## Browsers

- Only Chrome (and Chromium browsers) for now.

← [Import and export](import-export.md) · Next: [FAQ](faq.md) →
