# dsh-browser-panel — Embedded headed browser for DSH WebUI

> Public open-source DSH plugin. License: Apache-2.0.

This plugin embeds a real, user-visible browser in the DeepSeek Harness WebUI.
The model controls the browser through text-only tools (`browser_snapshot`,
`browser_click`, `browser_type`, etc.) using numbered accessibility-style
snapshots; screenshots are for humans only and do not enter the model context
by default.

## Feature highlights

- Per-session Playwright Chromium instance
- Live screencast panel in the WebUI
- Multi-tab support
- Persistent login profiles (optional)
- Console/dialog/download observation
- Optional VLM bridge (`browser_vision`), disabled by default

## Build

```bash
npm install --ignore-scripts
npm run build
```

## License

Apache-2.0. See the repository root LICENSE file.
