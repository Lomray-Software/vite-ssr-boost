import sinon from 'sinon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ICliContext } from '@constants/cli-context';
import shortcuts from '@constants/cli-shortcuts';

const { processStopMock } = vi.hoisted(() => ({
  processStopMock: vi.fn(),
}));

vi.mock('@helpers/process-stop', () => ({
  default: processStopMock,
}));

describe('cli-shortcuts', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
    processStopMock.mockReset();
  });

  const createContext = (closeResult?: unknown) => {
    const info = sandbox.stub();
    const clearScreen = sandbox.stub();
    const printUrls = sandbox.stub();
    const openBrowser = sandbox.stub();
    const close = sandbox.stub().resolves(undefined);
    const reboot = sandbox.stub().resolves();
    const serverClose = sandbox.stub().callsFake((resolve: (err?: unknown) => void) => {
      resolve(closeResult);
    });

    return {
      context: {
        reboot,
        server: { close: serverClose } as never,
        config: {
          getLogger: () => ({ info, clearScreen }),
          getVite: () => ({ close, printUrls, openBrowser }),
        },
      } as unknown as ICliContext,
      stubs: { info, clearScreen, printUrls, openBrowser, close, reboot, serverClose },
    };
  };

  it('should restart server on "r" shortcut', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext();

    await shortcut.action(context);

    expect(stubs.info.firstCall.args[0]).toContain('restarting server');
    expect(stubs.close.calledOnce).toBe(true);
    expect(stubs.reboot.calledOnceWithExactly(false)).toBe(true);
    expect(stubs.info.lastCall.args[0]).toContain('server restarted successful');
  });

  it('should not restart when a termination signal arrived during the drain', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext();
    const lifecycle = {
      close: sandbox.stub().callsFake(() => {
        context.isExiting = true;

        return Promise.resolve();
      }),
    };

    context.lifecycle = lifecycle as unknown as ICliContext['lifecycle'];
    await shortcut.action(context);

    expect(lifecycle.close.calledOnce).toBe(true);
    expect(stubs.reboot.called).toBe(false);
  });

  it('should stop restart flow when server closing fails', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext('boom');

    await shortcut.action(context);

    expect(stubs.info.lastCall.args[0]).toContain('failed to stop dev server');
    expect(stubs.reboot.called).toBe(false);
  });

  it('should drain through the lifecycle on restart when the server has one', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext();
    const close = sandbox.stub().resolves();

    await shortcut.action({ ...context, lifecycle: { close } as never });

    expect(close.calledOnce).toBe(true);
    expect(stubs.serverClose.called).toBe(false);
    expect(stubs.close.called).toBe(false);
    expect(stubs.reboot.calledOnceWithExactly(false)).toBe(true);
  });

  it('should stop restart flow when the lifecycle drain fails', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext();
    const close = sandbox.stub().rejects(new Error('drain failed'));

    await shortcut.action({ ...context, lifecycle: { close } as never });

    expect(stubs.info.lastCall.args[0]).toContain('failed to stop dev server');
    expect(stubs.info.lastCall.args[0]).toContain('drain failed');
    expect(stubs.reboot.called).toBe(false);
  });

  it('should print urls on "u" shortcut', () => {
    const shortcut = shortcuts.find(({ key }) => key === 'u')!;
    const { context, stubs } = createContext();

    shortcut.action(context);

    expect(stubs.info.calledOnceWithExactly('')).toBe(true);
    expect(stubs.printUrls.calledOnce).toBe(true);
  });

  it('should clear console on "c" shortcut', () => {
    const shortcut = shortcuts.find(({ key }) => key === 'c')!;
    const { context, stubs } = createContext();

    shortcut.action(context);

    expect(shortcut.isOnlyDev).toBe(true);
    expect(stubs.clearScreen.calledOnceWithExactly('error')).toBe(true);
  });

  it('should open browser on "o" shortcut', () => {
    const shortcut = shortcuts.find(({ key }) => key === 'o')!;
    const { context, stubs } = createContext();

    shortcut.action(context);

    expect(shortcut.isOnlyDev).toBe(true);
    expect(stubs.openBrowser.calledOnce).toBe(true);
  });

  it('should stop server and exit on "q" shortcut', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'q')!;
    const { context, stubs } = createContext();

    await shortcut.action(context);

    expect(stubs.close.calledOnce).toBe(true);
    expect(processStopMock).toHaveBeenCalledOnce();
  });

  it('should drain on "q" even when the logger cannot be read', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'q')!;
    const close = sandbox.stub().resolves();
    const context = {
      config: {
        getLogger: () => {
          throw new Error('no logger');
        },
      },
      lifecycle: { close },
    } as unknown as ICliContext;

    await shortcut.action(context);

    expect(close.calledOnce).toBe(true);
    expect(processStopMock).toHaveBeenCalledOnce();
  });

  it('should stop the restart when the drain fails and the logger cannot be read', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = sandbox.stub();
    let reads = 0;
    const reboot = sandbox.stub().resolves();
    const close = sandbox.stub().rejects(new Error('drain failed'));
    const context = {
      reboot,
      config: {
        // the first read prints the restarting line, the failure report reads again
        getLogger: () => {
          reads += 1;

          if (reads > 1) {
            throw new Error('no logger');
          }

          return { info };
        },
      },
      lifecycle: { close },
    } as unknown as ICliContext;

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(close.calledOnce).toBe(true);
    expect(reboot.called).toBe(false);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0][0]).toContain('failed to stop dev server: drain failed');
    consoleError.mockRestore();
  });

  it('should exit on "q" when the server close fails and the logger cannot be read', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'q')!;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = {
      server: {
        close: (resolve: (err?: unknown) => void) => resolve(new Error('close failed')),
      },
      config: {
        getLogger: () => {
          throw new Error('no logger');
        },
        getVite: () => undefined,
      },
    } as unknown as ICliContext;

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(processStopMock).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0][0]).toContain('failed to stop dev server: close failed');
    consoleError.mockRestore();
  });

  it('should exit on "q" when the vite close fails after the server closed', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'q')!;
    const { context, stubs } = createContext();

    stubs.close.rejects(new Error('vite close failed'));

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(stubs.serverClose.calledOnce).toBe(true);
    expect(stubs.info.lastCall.args[0]).toContain('failed to stop dev server: vite close failed');
    expect(processStopMock).toHaveBeenCalledOnce();
  });

  it('should close vite and report the server failure when both closes fail', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext(new Error('close failed'));

    stubs.close.rejects(new Error('vite close failed'));

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(stubs.close.calledOnce).toBe(true);
    expect(stubs.info.lastCall.args[0]).toContain('failed to stop dev server: close failed');
    expect(stubs.reboot.called).toBe(false);
  });

  it('should restart once on "r" when the logger cannot be read at all', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reboot = sandbox.stub().resolves();
    const close = sandbox.stub().resolves();
    const context = {
      reboot,
      config: {
        getLogger: () => {
          throw new Error('no logger');
        },
      },
      lifecycle: { close },
    } as unknown as ICliContext;

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(close.calledOnce).toBe(true);
    expect(reboot.calledOnceWith(false)).toBe(true);
    expect(consoleError.mock.calls.map(([line]) => line as string)).toEqual([
      '\nrestarting server...',
      'server restarted successful.',
    ]);
    consoleError.mockRestore();
  });

  it('should close vite and exit on "q" when the server close throws', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'q')!;
    const { context, stubs } = createContext();

    stubs.serverClose.throws(new Error('close threw'));

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(stubs.close.calledOnce).toBe(true);
    expect(stubs.info.lastCall.args[0]).toContain('failed to stop dev server: close threw');
    expect(processStopMock).toHaveBeenCalledOnce();
  });

  it('should count a server close that throws undefined as a failed stop', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext();

    context.server = {
      close: () => {
        throw undefined;
      },
    } as never;

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(stubs.close.calledOnce).toBe(true);
    expect(stubs.reboot.called).toBe(false);
    expect(stubs.info.lastCall.args[0]).toContain('failed to stop dev server: undefined');
  });

  it('should close vite and exit on "q" without a server', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'q')!;
    const { context, stubs } = createContext();

    delete context.server;

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(stubs.close.calledOnce).toBe(true);
    expect(processStopMock).toHaveBeenCalledOnce();
  });

  it('should close vite and restart once on "r" without a server', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext();

    delete context.server;

    await expect(shortcut.action(context)).resolves.toBeUndefined();

    expect(stubs.close.calledOnce).toBe(true);
    expect(stubs.reboot.calledOnceWithExactly(false)).toBe(true);
    expect(stubs.info.lastCall.args[0]).toContain('server restarted successful');
  });
});
