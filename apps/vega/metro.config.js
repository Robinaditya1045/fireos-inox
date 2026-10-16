const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * packages/core lives outside this app and has no runtime dependencies of its own, so watching the
 * folder is enough for Metro to bundle it (decision D9: standalone npm app + watchFolders).
 *
 * @type {import('metro-config').MetroConfig}
 */
const core = path.resolve(__dirname, '../../packages/core');
const escape = (p) => p.replace(/[/\\.*+?^${}()|[\]]/g, '\\$&');

const config = {
  watchFolders: [core],
  resolver: {
    // Core's own node_modules holds only its test tooling (Vitest); keep the default __tests__ rule.
    blockList: [/(\/__tests__\/.*)$/, new RegExp(`^${escape(core)}/(node_modules|test)/.*`)],
    // Babel injects @babel/runtime helpers into core's files; resolve them from this app.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
