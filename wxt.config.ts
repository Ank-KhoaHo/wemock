import { defineConfig } from 'wxt';

// See docs/superpowers/specs/A1-version-1-record-and-replay.md, section 3.
// Sites are off by default: only localhost is granted at install. Every other
// site is requested one origin at a time, at the moment the user enables it.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'wemock',
    description:
      'Record real API calls in Chrome DevTools, then replay them as mock scenarios. WebSocket and SignalR too.',
    // offscreen: spec A2, code mocks run in a sandboxed iframe inside an offscreen document.
    permissions: ['storage', 'unlimitedStorage', 'scripting', 'offscreen'],
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    optional_host_permissions: ['<all_urls>'],
    content_security_policy: {
      // The sandbox page (no extension APIs, opaque origin) may eval, and may start
      // the blob: Worker each code mock runs in. Extension pages keep the strict default.
      sandbox:
        "sandbox allow-scripts; script-src 'self' 'unsafe-eval' blob:; worker-src blob:; child-src blob:; object-src 'none';",
    },
  },
});
