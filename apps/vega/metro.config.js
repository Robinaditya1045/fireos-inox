const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * packages/core lives outside this app and has no dependencies of its own, so watching the folder
 * is enough for Metro to bundle it (decision D9: standalone npm app + watchFolders).
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.resolve(__dirname, '../../packages/core')],
  resolver: {
    // Babel injects @babel/runtime helpers into core's files; resolve them from this app.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
