import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import serverOption from '@cli/helpers/server-option';

/**
 * Parse arguments with a command that throws instead of exiting.
 */
const parse = (args: string[]): Record<string, unknown> => {
  const command = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => undefined })
    .addOption(serverOption);

  command.parse(args, { from: 'user' });

  return command.opts();
};

describe('cli/helpers/server-option', () => {
  it('should accept node and express', () => {
    expect(parse(['--server', 'node']).server).toBe('node');
    expect(parse(['--server=express']).server).toBe('express');
  });

  it('should leave the server unset when the option is absent', () => {
    expect(parse([]).server).toBeUndefined();
  });

  it('should reject a missing value instead of parsing it as true', () => {
    expect(() => parse(['--server'])).toThrow(
      expect.objectContaining({ code: 'commander.optionMissingArgument' }),
    );
  });

  it('should reject an unknown server', () => {
    expect(() => parse(['--server', 'bogus'])).toThrow(
      expect.objectContaining({ code: 'commander.invalidArgument' }),
    );
  });
});
