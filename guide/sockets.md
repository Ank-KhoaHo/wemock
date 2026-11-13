# WebSocket and SignalR

A socket mock answers a WebSocket URL with no server behind it. Click **+ New socket** in the
Mocks tab, and pick its kind.

## Plain WebSocket

- **On connect:** messages the "server" sends after the socket opens, each after a delay in
  milliseconds.
- **Replies:** when a message the client sends contains some text (or any message, if empty),
  answer with a fixed text or with code, then send more messages on a timeline.

## SignalR (JSON hub protocol)

wemock also answers SignalR's `negotiate` call, the handshake and the pings, so your client's
`HubConnection.start()` works as with a real hub.

- **On connect:** hub methods the client receives (`on("Notify", …)`), with their arguments as a
  JSON array, each after a delay.
- **Replies:** when the client calls a hub method (`invoke("Subscribe")`), respond with:

| Respond | The client gets |
|---|---|
| Fixed | the result, as JSON (empty for none) |
| Code | the result your code returns |
| Error | an error with your text, as a real hub sends |
| Stream | each item of a JSON array, for `connection.stream(…)` |

  Then send more messages, each after a delay.

## Record a real socket

Real sockets appear in the Log, with their messages in both directions. Click one, then **Mock
this socket**: wemock makes a socket mock with the server's messages and their timing. For
SignalR, pushes stay with the call that caused them.

## Limits

- SignalR mocks speak the JSON hub protocol only, not MessagePack.
- A real socket logs at most 200 messages.
- For a plain socket, "Mock this socket" replays the messages on a timeline; it cannot tell
  which message answered which.

← [Replies](replies.md) · Next: [Checking your mocks](checking.md) →
