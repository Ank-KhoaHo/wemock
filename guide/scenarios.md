# Scenarios

A scenario is a named set of mocks, such as "Checkout down" or "Empty shop". Each site has its
own project, and each project has its own scenarios.

## How they combine

- **Default** always applies.
- One other scenario can be **active** at a time. Its mocks are tried first; Default fills in
  everything it does not cover.

So "Checkout down" needs only the one mock that fails checkout. Products, the cart and the user
still come from Default.

## Switch

The chips at the top of the panel are your scenarios. Click one to make it active; click
**Default** to go back. The next call uses the new answers. No reload is needed unless the page
already made the call.

## Manage

In the **Mocks** tab:

| Button | What it does |
|---|---|
| New scenario | an empty scenario |
| Rename, Duplicate | on the selected scenario; a duplicate copies every mock |
| Export | saves the selected scenario alone as a file, to share it |
| Delete, Delete all | with the tick boxes, delete several at once; Default always stays |

Every delete and clear can be undone from the bar that appears.

Inside a scenario:

- The tick box on a mock switches it on or off, without deleting it.
- The arrows move a mock up or down. **The first mock that matches answers**, so order matters.
- **Duplicate** in the mock editor copies a mock.
- The filter box and the fold arrows keep long lists short.

← [Your first mock](first-mock.md) · Next: [Matching](matching.md) →
