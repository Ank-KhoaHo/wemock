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
      'Record real API calls in Chrome DevTools, then replay them as switchable mock scenarios.',
    permissions: ['storage', 'unlimitedStorage', 'scripting'],
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    optional_host_permissions: ['<all_urls>'],
  },
});
