# Roadmap

This is the shape of the journey, not its current state — the day-to-day backlog of specific
tasks is a maintainer's working material and is not published (see [PUBLIC.md](PUBLIC.md)).
This file is the only forward-looking view a reader outside the project gets, so keep it
honest: an empty milestone is more useful than a stale one.

## M0 — Bootstrap (done)

The repository, the MIT licence, the build, and CI.

## M1 — First usable version (done in source, 1.0.0)

Record calls in a DevTools panel, replay them as mocks, group mocks into scenarios, edit them,
and import or export projects, including Mokku's files.

## M1.1 — Code replies, Test bar, Console line (done in source, 1.1.0)

Mocks can answer with code, a Test bar shows which mock answers a URL, and each mocked call
writes a Console line.

## M1.2 — WebSocket and SignalR mocks (done in source, 1.2.0)

Socket mocks with a timeline and replies, and SignalR's JSON hub protocol on top.

## M1.3 — Record real sockets (done in source, 1.3.0)

Real sockets in the log, "Mock this socket", and recorded calls to other sites keep their host.

## M1.4 — Smarter replies and faster setup (done in source, 1.4.0)

Conditions on query, headers and body; templates; call sequences; HAR and OpenAPI import;
bulk scenario actions with Undo; search and fold; keyboard and contrast pass.

## M1.5 — Sharing and checking (done in source, 1.5.0)

Duplicate mocks and scenarios, one-scenario files, Log filters and HAR export, help in an empty
panel; checked on real React, axios and Angular apps, a real SignalR hub, and a load test.

## M1.6 — SignalR like a real hub (done in source, 1.6.0)

Errors and streams in SignalR mocks, and recorded pushes that stay with the call that caused them;
checked against a real ASP.NET Core hub.

## M2 — Hardening

The rough edges found by daily use of 1.0.0, closed one at a time.

## M3 — Chrome Web Store

The first Store release.

## Later, if people ask

- Firefox and Edge builds.
- Rewriting headers on real calls.

## Things deliberately not coming

- **Intercepting through `chrome.debugger`.** It shows a warning bar on every tab.
