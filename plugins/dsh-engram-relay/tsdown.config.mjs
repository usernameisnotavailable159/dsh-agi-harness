/**
 * Self-contained build for @dsh-external/dsh-engram-relay.
 *
 * This config deliberately bundles both the Node host entry and the WebUI
 * client entry directly from TypeScript sources with tsdown. It does not
 * require a DSH source checkout or a first `tsc` pass; host-provided
 * `@deepseek-ai/*` and `cordis`/`schemastery` services are kept external.
 */
const PLUGIN_ID = '@dsh-external/dsh-engram-relay'

const HOST_EXTERNALS = [
  'cordis',
  'schemastery',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@huggingface/transformers',
  'onnxruntime-node',
]

export default [
  {
    // Host half: lib/index.js.
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: HOST_EXTERNALS,
  },
  {
    // Browser half: lib/client.js.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
