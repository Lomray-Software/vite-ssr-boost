import hoistNonReactStatics from 'hoist-non-react-statics';
import type { FC } from 'react';
import React, { useEffect, useState } from 'react';
import type { FCAny } from '@interfaces/fc';

/**
 * HOC: Render component only on client side
 */
const renderClient = <T extends Record<string, any>>(
  Component: FCAny<T> | null | undefined,
): FC<T> => {
  const Element: FC<T> = (props) => {
    const [shouldRender, setShouldRender] = useState(false);

    useEffect(() => {
      setShouldRender(true);
    }, []);

    if (shouldRender && Component) {
      return <Component {...props} />;
    }

    return null;
  };

  hoistNonReactStatics(Element, Component);

  return Element;
};

export default renderClient;
