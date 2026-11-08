// Runs in the ISOLATED world: relays page <-> extension. Registered at runtime.
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  runAt: 'document_start',
  main() {
    // Task 5 fills this in.
  },
});
