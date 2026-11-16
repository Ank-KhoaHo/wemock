# Import and export

## Import

**Import** at the top of the panel opens a window: drop a file on it or choose one. wemock reads
any of these, and finds out which it is by itself:

| File | Becomes |
|---|---|
| a wemock file | its scenarios and mocks |
| a HAR file (DevTools Network tab: "Save all as HAR") | one mock per call |
| OpenAPI 3 or Swagger 2, JSON or YAML | one mock per operation, from its examples |
| a JSON mock file or mock export | its mocks; function mocks become code mocks |

It says what it found, then you choose:

- **Add to what you have:** keep your mocks and add the file's. Scenarios with the same name get
  a new one.
- **Replace everything:** your mocks for this site become the file's.

Then **Import**, or **Cancel**. Both can be undone from the message that appears. When the site
has nothing yet, wemock imports without asking.

## Export

- **Export** at the top of the panel saves the site's whole project, or only the active scenario.
- The arrow on a scenario's header saves that scenario alone.
- **Save HAR** in the Log saves the calls you see.

A wemock file is plain JSON. Commit it next to your app, and the whole team imports the same
mocks.

## Start over

The red bin beside **Filter mocks** removes every mock and scenario for this site, after asking,
with Undo.

← [Checking your mocks](checking.md) · [Back to the guide](README.md)
