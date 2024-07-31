/* eslint-disable no-undef */
// @ts-ignore
const IS_SSR_MODE = (typeof __IS_SSR__ === 'undefined' ? true : __IS_SSR__) as boolean; // build in SSR mode?

// const IS_SERVER = typeof window === 'undefined';

// eslint-disable-next-line import/prefer-default-export
export { IS_SSR_MODE };
