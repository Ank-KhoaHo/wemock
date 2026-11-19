# The wemock lab

A small real shop, built with ASP.NET Core 10 and run in Docker, for trying every kind of mock against
real traffic and the real client libraries.

## Run it

You need Docker. Build wemock first (`npm run build`), then:

```
bash lab/run.sh serve   # the lab at http://localhost:5199, until Ctrl+C
bash lab/run.sh test    # starts the lab, runs features.spec.ts and perf.spec.ts, stops it
bash lab/run.sh perf    # starts the lab, runs perf.spec.ts only
```

The first start builds the shop inside the container and takes about a minute.

## What is in it

Each button on the page makes one kind of call, and the answer shows beside it.

| Kind of mock | Call |
|---|---|
| Fixed reply | `GET /api/products` |
| URL parameters | `GET /api/products/{id}`, `GET /api/categories/{category}/products/{id}` |
| Query | `GET /api/products/search?q=&page=&sort=` |
| Code | `GET /api/price/{id}?qty=` |
| Sequence | `GET /api/orders/{id}/status`: the real one moves from pending to packed to shipped |
| Scenario | `POST /api/checkout`, for a "Checkout down" scenario |
| Condition on the body | `POST /api/cart`, with or without the coupon `TEA10` |
| Condition on a header | `GET /api/me`, with or without `Authorization` |
| Change real | `GET /api/recommendations` |
| Binary body | `GET /api/products/{id}/image`, a PNG |
| Stream, Server-Sent Events | `GET /api/assistant`, read with `EventSource` |
| GraphQL operation | `POST /graphql`, `GetProducts` or `GetOrder` |
| Plain WebSocket | `/ws/echo` |
| SignalR | `/hubs/orders`: a push on connect, `Subscribe`, `GetPrice`, a stream, and an error |
| Many mocks | `GET /api/items/{n}` for n = 1 to 1000, **Call all 900**, and `/openapi.json` with 900 operations |

The page uses `fetch`, `XMLHttpRequest`, axios, `EventSource`, `WebSocket` and the official
`@microsoft/signalr` client. The two libraries are copied from `node_modules` when the lab starts.

## The tests

- `features.spec.ts`: each kind of mock above, seen first as the real answer and then as the mocked one.
- `perf.spec.ts`: the panel with 900 mocks and 900 logged calls. It times a key in each filter, scrolling,
  opening a mock, a key in the editor, and folding a scenario, and writes the times to `lab/out/`. A step
  over the panel's budget of 100 ms fails softly, so every step still runs.

They need Docker, so CI does not run them.
