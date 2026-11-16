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

In the **Mocks** tab, click a scenario's header to make it active; it turns blue and says
**Active**. Click **Default** to go back. The next call uses the new answers. No reload is
needed unless the page already made the call.

The popup (the wemock icon in Chrome's toolbar) has the same choice, as a dropdown.

## Manage

**+** at the top of the list adds a mock, a socket mock or a scenario. A new mock goes into the
active scenario.

Each scenario's header has its own icons:

| Icon | What it does |
|---|---|
| Pencil | renames it, in place: Enter saves, Escape cancels |
| Copy | duplicates it, with every mock |
| Arrow up | saves it alone as a file, to share it |
| Bin | deletes it; on Default, deletes every mock in it and keeps Default |

The red bin beside the filter deletes every mock and scenario for the site, after asking.
Every delete can be undone from the message that appears.

Inside a scenario:

- The arrows move a mock up or down. **The first mock that matches answers**, so order matters.
- The bin on a row deletes that mock.
- The switch in the mock editor turns a mock on or off, without deleting it. An off mock is faded.
- The filter box and the fold arrows keep long lists short. The list scrolls as one, and each
  scenario's name stays in view over its mocks.

← [Your first mock](first-mock.md) · Next: [Matching](matching.md) →
