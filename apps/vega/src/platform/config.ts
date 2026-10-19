// Local-development configuration, written by scripts/write-app-config.mjs into two git-ignored files:
//   config.generated.ts          API address, backend kind, PlayerLab settings (no secrets)
//   devCredentials.generated.ts  the seeded TV user, prefilled on the sign-in screen in dev builds
import {generatedConfig} from './config.generated';

type DevCredentials = {email: string; password: string};

// The credentials module is required only inside a __DEV__ branch. Metro's non-dev transform inlines
// __DEV__ as false and constant-folds the branch before it collects dependencies, so release bundles
// never contain the module or the seeded password (security audit 2026-10-20). A static import would
// bundle it even though nothing reads it.
const devCredentials: DevCredentials = __DEV__
  ? (require('./devCredentials.generated') as {devCredentials: DevCredentials}).devCredentials
  : {email: '', password: ''};

export const config = {
  apiBaseUrl: generatedConfig.apiBaseUrl,
  wsBaseUrl: generatedConfig.wsBaseUrl,
  devEmail: devCredentials.email,
  devPassword: devCredentials.password,
  /** Dev-only player test bench (src/dev/PlayerLab.tsx) instead of the app, for R17. */
  playerLab: __DEV__ ? generatedConfig.playerLab : null,
};
