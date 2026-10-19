import type {Logger} from '../../../../packages/core/src';

// Every line is prefixed "FOI" so device logs can be filtered:
//   vega device run-cmd --command 'loggingctl log -v com.fireosinox.tv | grep FOI'
function line(level: string, tag: string, msg: string, ctx?: Record<string, unknown>): string {
  return `FOI ${level} [${tag}] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`;
}

export const logger: Logger = {
  // Debug lines (focus, keys, player internals) are for development only.
  debug: __DEV__ ? (tag, msg, ctx) => console.debug(line('D', tag, msg, ctx)) : () => {},
  info: (tag, msg, ctx) => console.info(line('I', tag, msg, ctx)),
  warn: (tag, msg, ctx) => console.warn(line('W', tag, msg, ctx)),
  error: (tag, msg, ctx) => console.error(line('E', tag, msg, ctx)),
};
