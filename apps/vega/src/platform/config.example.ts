// Shapes of the two git-ignored files that scripts/write-app-config.mjs writes next to config.ts.

// config.generated.ts: bundled into every build, so it must never hold secrets.
export const generatedConfig = {
  backend: 'stack',
  apiBaseUrl: 'http://localhost:18080/api/v1',
  wsBaseUrl: 'ws://localhost:18080/api/v1',
  playerLab: null as null | {url: string; level: number; hls: Record<string, unknown>; suite: string},
};

// devCredentials.generated.ts: the seeded TV user (from .devstack/seed-credentials.json, or the mock's
// password). config.ts requires it only when __DEV__, so release bundles leave it out.
export const devCredentials = {
  email: '',
  password: '',
};
