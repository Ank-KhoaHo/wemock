# Replies

Every mock has a **status** (200 to 599), **headers**, a **delay** in milliseconds, and a
**Reply**. The Reply is one of five kinds.

## Fixed body

The body as text, or as a file. **Load file** takes any file (an image, a PDF, a download), and
wemock serves its exact bytes.

### Templates

Tick **Fill {{templates}}**, and parts of a text body are filled in for each call:

| Write | Gets |
|---|---|
| `{{params.id}}` | the `:id` part of the URL pattern |
| `{{query.page}}` | the `page` query parameter |
| `{{headers.x-user}}` | a request header |
| `{{body.user.name}}` | a field of the JSON request body |
| `{{uuid}}` | a new random id |
| `{{now}}`, `{{timestamp}}` | the time, as ISO text or as milliseconds |

## Sequence

A list of replies, one per call: "pending", "pending", "done". After the last one, either keep
answering the last, or start over. The count starts again when the page reloads.

## Code

A few lines of JavaScript that return the body. `params`, `query`, `body` and `req` describe the
call. `res` starts with the status, headers and delay above; change it to answer differently.

```js
// /api/products/:id
const id = Number(req.params.id);
if (id > 100) {
  res.status = 404;
  return { error: `No product ${id}` };
}
return { id, name: `Product ${id}`, price: 4.5 };
```

- `req.callCount` counts the calls to this mock since the page loaded.
- The editor suggests `req.`, `res.` and your pattern's parameters as you type.
- **Run** tries the code on a URL before you save it.
- The code runs in a sandboxed page with no access to your page or to wemock, and stops after
  1 second. Code that fails answers 500 with its error message.

## Change real

Let the real call through, then change its answer: the status, headers, or JSON fields.

- **Set fields:** a path and a value, such as `user.flags.beta` = `false`. `*` walks every item
  of a list: `items.*.price` = `0`.
- **Remove fields:** a path, such as `user.email`.

Use it to test "the real data, except this one flag".

## Stream (next release)

The body arrives in chunks, a gap apart: an AI chat that types its answer, a progress feed, a
log tail.

- Add a **chunk** per piece of the body, and set the **Gap (ms)** between them.
- `fetch`: `res.body.getReader()` and `for await` see each chunk as it arrives; `res.text()`
  waits for all of them.
- Tick **As Server-Sent Events**, and each chunk is sent as a `data:` frame with
  `content-type: text/event-stream`. A chunk that already has `event:` or `id:` lines is sent as
  written.
- `EventSource` gets the same mock: `open`, then a `message` (or your `event:` name) per chunk,
  then the stream closes. It does not reconnect in a loop.
- `XMLHttpRequest` gets the whole body at the end.

```
event: token
id: 1
data: Hel
```

← [Matching](matching.md) · Next: [WebSocket and SignalR](sockets.md) →
