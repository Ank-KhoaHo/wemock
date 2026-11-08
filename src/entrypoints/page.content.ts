// Runs in the page's MAIN world at document_start. Registered at runtime by
// the background worker for enabled sites only, never through the manifest.
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    // Task 4 and Task 6 install the fetch and XHR patches here.
  },
});
