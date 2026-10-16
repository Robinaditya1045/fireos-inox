// Local-development configuration. config.generated.ts is written by scripts/write-app-config.mjs
// and is git-ignored; it carries the API address and, in dev builds, the seeded TV user.
import {generatedConfig} from './config.generated';

export const config = {
  apiBaseUrl: generatedConfig.apiBaseUrl,
  wsBaseUrl: generatedConfig.wsBaseUrl,
  devEmail: __DEV__ ? generatedConfig.devEmail : '',
  devPassword: __DEV__ ? generatedConfig.devPassword : '',
};
