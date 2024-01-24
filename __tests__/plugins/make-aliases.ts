import fs from 'node:fs';
import { expect } from 'chai';
import sinon from 'sinon';
import { afterEach, describe, it } from 'vitest';
import PLUGIN_NAME from '@constants/plugin-name';
import ViteMakeAliasesPlugin from '@plugins/make-aliases';

describe('ViteMakeAliasesPlugin', () => {
  const root = '/project-root';
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should set aliases in Vite config based on tsconfig', () => {
    const tsconfigPath = '/path/to/tsconfig.json';
    const aliases = {
      '@src/*': ['./src/*'],
      '@components/*': ['./src/components/*'],
    };

    sandbox.stub(fs, 'existsSync').returns(true);
    sandbox
      .stub(fs, 'readFileSync')
      .returns(JSON.stringify({ compilerOptions: { paths: aliases } }));
    const config = { resolve: { alias: {} }, root };

    // @ts-ignore
    const result = ViteMakeAliasesPlugin({ tsconfig: tsconfigPath, root: '' }).config(config);

    expect(result.resolve.alias).to.deep.equal([
      { find: '@src', replacement: `${root}/src` },
      { find: '@components', replacement: `${root}/src/components` },
    ]);
  });

  it('should print an error message if tsconfig file does not exist', () => {
    const consoleStub = sandbox.stub(console, 'error');
    const tsconfigPath = '/path/to/nonexistent/tsconfig.json';

    sandbox.stub(fs, 'existsSync').returns(false);
    ViteMakeAliasesPlugin({ tsconfig: tsconfigPath });

    expect(
      consoleStub.calledOnceWithExactly(
        `${PLUGIN_NAME}-make-aliases: tsconfig not exist in "${tsconfigPath}"`,
      ),
    ).to.be.true;
  });

  it('should use default values when options are not provided', () => {
    const config = { resolve: { alias: {} } };
    // @ts-ignore
    const result = ViteMakeAliasesPlugin().config(config);

    expect(result).to.deep.equal(config);
  });

  it('should use default values when tsconfig is not provided', () => {
    sandbox.stub(console, 'error');

    const config = { resolve: { alias: {} } };
    // @ts-ignore
    const result = ViteMakeAliasesPlugin({ root }).config(config);

    expect(result).to.deep.equal(config);
  });
});
