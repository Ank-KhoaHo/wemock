# Install

wemock is not on the Chrome Web Store yet. Until it is, you load it as an unpacked extension.

## From a release

1. Download `wemock-<version>-chrome.zip` from the
   [latest release](https://github.com/Ank-KhoaHo/wemock/releases/latest).
2. Unzip it into a folder you will keep. Chrome reads the extension from that folder every time.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Choose **Load unpacked**, and pick the unzipped folder.

wemock's icon appears in the toolbar. Pin it if you like.

## From source

You need Node.js 22 or later.

```
git clone https://github.com/Ank-KhoaHo/wemock.git
cd wemock
npm ci
npm run build
```

Then load `.output/chrome-mv3` with **Load unpacked**, as above.

## Switch it on for a site

- **`localhost` and `127.0.0.1`** (http and https): always on. Nothing to do.
- **Any other site:** open the site, click the wemock toolbar icon, and switch wemock on for that
  site. Chrome asks for access to that one site. Reload the page once, so wemock's script loads.

wemock never runs on a site you have not switched on.

## Open the panel

Open DevTools (F12) and pick the **wemock** tab. If you do not see it, look under the `»` menu
of DevTools' tab bar.

## Update

Download the new zip, unzip it **over the same folder**, then click the reload arrow on wemock's
card in `chrome://extensions`. Your mocks stay.

Chrome ties an unpacked extension's storage to its folder. Before you move the folder or load it
from somewhere else, **Export** your mocks from the Mocks tab, and import them again afterwards.

## What the permissions are for

| Permission | Why |
|---|---|
| storage, unlimitedStorage | your mocks and scenarios, kept in your browser; binary mocks can be large |
| scripting | puts wemock's page script only on the sites you switched on |
| activeTab | lets the toolbar popup read the address of the tab you opened it on |
| offscreen | runs code mocks in a sandboxed page, stopped after 1 second |
| localhost, 127.0.0.1 | wemock is on there by default; every other site is asked for one at a time |

wemock sends nothing anywhere.

← [Guide](README.md) · Next: [Your first mock](first-mock.md) →
