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

  it('should stop restart flow when server closing fails', async () => {
    const shortcut = shortcuts.find(({ key }) => key === 'r')!;
    const { context, stubs } = createContext('boom');

    await shortcut.action(context);

    expect(stubs.info.lastCall.args[0]).toContain('failed to stop dev server');
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
});
