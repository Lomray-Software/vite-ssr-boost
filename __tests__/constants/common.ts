import { describe, expect, it } from 'vitest';
import cliContext from '@constants/cli-context';
import cliName from '@constants/cli-name';
import pluginName from '@constants/plugin-name';

describe('constants/common', () => {
  it('should expose stable default constants', () => {
    expect(cliName).toBe('ssr-boost');
    expect(pluginName).toBe('@lomray/vite-ssr-boost');
    expect(cliContext).toEqual({ isProd: false });
  });
});
