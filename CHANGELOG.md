# Changelog

Every release of wemock, newest first, in the words of whoever uses it.

A released block's heading is the version, then the date: `## 0.1.0 — 2026-01-31`. The newest
released version is also what the `VERSION` file holds, and the name of a git tag (`v` followed
by the version).

## Unreleased

- **Hundreds of mocks stay quick:** with 900 mocks, a key in Filter mocks took 838 ms and a key in
  the Log's filter 751 ms; both now take about a tenth of that (#10).
- A header rule typed quickly no longer saves an older value.
- **Calls from iframes:** a call made by an iframe on the site now shows in the Log, and mocks answer
  it. Before, only the page's own calls did.
- **A lab** (`lab/`): a real ASP.NET Core shop in Docker that exercises every kind of mock, with
  900 endpoints and a timing test. `bash lab/run.sh serve` starts it.

## 1.9.0 — 2026-11-17

A new panel, shaped by what people said about 1.8.

- **One header:** Import, Export and the yellow Sample sit at the top, beside the site's project.
  Rec, Console and On/off are on the right. Log and Mocks moved to a rail on the left.
- **Import** opens a window: drop or choose a file, see what it holds, then add it or replace
  everything. A site with nothing yet imports without asking.
- **Export** offers the whole project, or only the active scenario.
- **Scenarios:** click a scenario's header to make it active. Each header has its own icons to
  rename, duplicate, export and delete. Default's bin empties it and keeps it.
- **No more checkboxes.** A mock's on and off is a switch in its editor; an off mock is faded.
- **+** adds a mock, a socket mock or a scenario. The red bin beside the filter deletes everything,
  after asking.
- **Messages:** every change says what it did, at the bottom of the panel. Deletes have Undo.
- **Icons in the editors:** duplicate, delete in red, save in blue. Ctrl+S saves.
- **Bigger text:** 13 px, with labels in sentence case.
- **Small panels:** docked narrow at the side or short at the bottom, the panel still fits; the
  list and the editor take turns, with a back arrow.
- **The popup** picks the active scenario from a dropdown, and says how to open wemock in
  DevTools.
- **The Test bar is gone.** The Log's Answered by says which mock answered each call.
- **Long lists scroll again:** a scenario with hundreds of mocks was cut off at the panel's
  height, so its later mocks, and every scenario after it, could not be reached.
- **Large text bodies no longer slow the panel:** a body over 100,000 characters, or one that does
  not start like JSON, opens as plain text. Typing in Filter mocks with such a body open took up to
  150 ms a key.
- The editor shows a JSON body over lines, with a guide line for each level, and **Format** spreads
  it again. Saving and exporting keep it compact. Thanks to an outside contributor (#2).
- An unknown file's import error now names the formats wemock reads: wemock, HAR, OpenAPI or
  a JSON mock file.
- Releases are built from a version tag by a workflow, which stops at a draft.

## 1.8.0 — 2026-11-13

- **Stream replies:** send a reply in chunks over time, as Server-Sent Events too.
  `EventSource` works.
- **Header rules:** add, change or remove request headers on calls that go to the server, such
  as a test `Authorization` token. The Log marks what a rule changed.
- **Mock selected:** tick rows in the Log and turn them into mocks in one step.
- **Never answers:** a mock that another mock above it always beats gets a mark. Hover to see
  which one wins.
- **Load the sample:** a small shop with every kind of mock, to try wemock in a minute.
- **Fixes** from a security and correctness review, and faster switching between tabs.
- **Patterns with a host** keep their escapes and `{optional}` parts. Thanks to @ThanggDuongg
  for this first outside contribution (#1).
- A new README, a guide, and the mockingbird icon.
- Adds the `activeTab` permission, so the toolbar popup can read the address of the tab you
  opened it on.

## 1.7.0 — 2026-11-11

- **Change real:** let the real call go through, then change its status, headers or JSON
  fields, such as `user.flags.beta` to `false` or every `items.*.price` to `0`. Works with
  fetch and XMLHttpRequest; a binary body keeps its bytes.
- **Code mocks:** the editor suggests `req.`, `res.` and the URL pattern's parameters as you
  type, and **Run** tries the code on a URL before you save it. Code you have not saved runs
  only from wemock's own panel; a web page cannot send code.

## 1.6.0 — 2026-11-10

SignalR like a real hub: the official client gets the same answers from a wemock mock as from
a real ASP.NET Core hub.

- **Streams:** a reply can be a stream of items; `connection.stream(...)` works, and
  cancelling stops it.
- **Errors:** a reply can be an error, and a method the mock does not know fails with "Method
  does not exist", as on a real hub.
- **Mock this socket** keeps errors and streams, and keeps a message the hub sends during or
  right after a call with that call.

## 1.5.0 — 2026-11-10

- **Duplicate** a mock, a socket mock or a whole scenario.
- **Share one scenario:** export it to a file, and import it as a new scenario.
- **Log filters** by type (MOCK, real, LATE), method and status class, and **Save HAR** of the
  rows shown.
- **Help in an empty panel:** it says whether wemock is off for the site or mocking is off,
  with a button to fix it.
- **Checked on real apps:** React (fetch), axios, Angular HttpClient and a real ASP.NET Core
  SignalR hub, plus a load check: every panel action under 100 ms.

## 1.4.0 — 2026-11-10

- **Conditions:** match a mock only when a query parameter, a request header or JSON body
  fields have given values.
- **Templates:** `{{params.id}}`, `{{query.page}}`, `{{body.user.name}}`, `{{uuid}}`, `{{now}}`
  in a fixed body.
- **Sequences:** each call gets the next reply ("pending, pending, done"); code mocks see
  `req.callCount`.
- **Import** a HAR file, or an OpenAPI or Swagger file (JSON or YAML). Import asks: add to
  your mocks, or replace them.
- **Scenarios:** select, delete and clear, with Undo; filter and fold the Mocks list.
- **Log:** names the mock that answered each call, with a link to it.
- **Keyboard and contrast pass** across the panel.

Versions 1.0.0 to 1.3.0 were built but not published as releases. They brought recording and
replay, code replies, the Test bar, the Console line, and WebSocket and SignalR mocks.
