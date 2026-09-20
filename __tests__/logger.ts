import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import DefaultLogger, { Logger, LogLevels, serializeErrors } from '../src/logger';

describe('logger entry', () => {
  it('exposes an extendable production logger and the error serializer', () => {
    class JsonLogger extends Logger {
      public error(msg: string): void {
        console.error(JSON.stringify({ msg }));
      }
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    new JsonLogger({ logLevel: LogLevels.error }).error('failed');
    expect(DefaultLogger).toBe(Logger);
    expect(error).toHaveBeenCalledWith('{"msg":"failed"}');
    expect(serializeErrors({ root: new Error('boom') })).toEqual({
      root: { message: 'boom', __type: 'Error' },
    });
    error.mockRestore();
  });

  it('is an explicit package export rather than a wildcard match', () => {
    const { exports } = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      exports: Record<string, unknown>;
    };

    expect(exports['./logger']).toEqual({ types: './logger.d.ts', default: './logger.js' });
  });
});
