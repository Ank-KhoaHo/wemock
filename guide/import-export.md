# Import and export

## Import

**Import** in the Mocks tab reads any of these, and finds out which it is by itself:

| File | Becomes |
|---|---|
| a wemock file | its scenarios and mocks |
| a HAR file (DevTools Network tab: "Save all as HAR") | one mock per call |
| OpenAPI 3 or Swagger 2, JSON or YAML | one mock per operation, from its examples |
| a JSON mock file or mock export | its mocks; function mocks become code mocks |

Then choose:

- **Add:** keep your mocks and add the file's. Scenarios with the same name get a new one.
- **Replace:** your mocks for this site become the file's.
- **Cancel.**

Both can be undone from the bar that appears.

## Export

- **Export** (top of the Mocks tab) saves the site's whole project: every scenario and mock.
- **Export** in the scenario toolbar saves the selected scenario alone.
- **Save HAR** in the Log saves the calls you see.

A wemock file is plain JSON. Commit it next to your app, and the whole team imports the same
mocks.

## Start over

**Clear all** removes every mock and scenario for this site, with Undo.

← [Checking your mocks](checking.md) · [Back to the guide](README.md)
