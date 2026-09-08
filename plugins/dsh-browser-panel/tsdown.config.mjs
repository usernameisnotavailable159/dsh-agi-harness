/**
 * Self-contained build for @dsh-external/dsh-browser-panel.
 *
 * This file intentionally does not depend on a DSH source checkout: it uses
 * tsdown to transpile TS directly, so `npm run build` / `prepare` work from a
 * clean git install. Runtime host dependencies (schemastery, playwright-core)
 * and browser platform modules (react) are left external and resolved by DSH
 * or the package manager.
 */
const PLUGIN_ID = '@dsh-external/dsh-browser-panel'

/** Node half externals: host dependencies supplied by the installed package. */
const NODE_EXTERNALS = ['schemastery', 'playwright-core']

/** Browser modules provided by the Web UI loader/application. */
const CLIENT_EXTERNALS = ['react']

export default [
  {
    // Host half: lib/index.js (plugin entry) + lib/invariant.js.
    entry: { index: 'src/index.ts', invariant: 'src/invariant.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: NODE_EXTERNALS,
  },
  {
    // Browser half: lib/client.js, served by DSH at /plugins/<id>/client.js.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    external: CLIENT_EXTERNALS,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
