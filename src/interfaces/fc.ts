import type { FC, PropsWithChildren } from 'react';

export type FCC<T extends Record<string, any>> = FC<PropsWithChildren<T>>;

export type FCAny<T extends Record<string, any>> = FC<T> | FCC<T>;
