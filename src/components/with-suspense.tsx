import hoistNonReactStatics from 'hoist-non-react-statics';
import type { FC } from 'react';
import React from 'react';
import type { FCAny, FCC } from '@interfaces/fc';

/**
 * Wrap component in suspense
 */
const withSuspense = <T extends Record<string, any>>(
  Component: FCAny<T>,
  Suspense: FCC<Record<string, any>>,
): FC<T> => {
  const Element: FC<T> = (props) => (
    <Suspense>
      <Component {...props} />
    </Suspense>
  );

  hoistNonReactStatics(Element, Component);

  return Element;
};

export default withSuspense;
