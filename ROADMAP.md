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

## M2 — Hardening

The rough edges found by daily use of 1.0.0, closed one at a time.

## M3 — Chrome Web Store

The first Store release.

## Later, if people ask

- Firefox and Edge builds.
- Matching on query strings and request bodies.
- Rewriting headers on real calls.

## Things deliberately not coming

- **Running user JavaScript to build responses.** It needs `eval`, which Store policy and
  wemock's own safety rule both forbid.
- **Intercepting through `chrome.debugger`.** It shows a warning bar on every tab.
