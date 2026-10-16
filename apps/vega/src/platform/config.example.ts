// Shape of config.generated.ts, which scripts/write-app-config.mjs writes (git-ignored).
export const generatedConfig = {
  backend: 'stack',
  apiBaseUrl: 'http://localhost:18080/api/v1',
  wsBaseUrl: 'ws://localhost:18080/api/v1',
  devEmail: '',
  devPassword: '',
  playerLab: null as null | {url: string; level: number; hls: Record<string, unknown>; suite: string},
};
