import type { ComponentType, ReactNode } from 'react';
import React, { lazy, startTransition, useEffect, useState } from 'react';

interface IOnlyClient<T> {
  load: () => Promise<{ default: ComponentType<T> } | ComponentType<T>>;
  children: (Component: ComponentType<T>) => ReactNode;
  fallback?: ReactNode;
}

/**
 * Render component only on client side
 * @constructor
 */
function OnlyClient<T>({ load, children, fallback }: IOnlyClient<T>): ReactNode {
  const [Component, setComponent] = useState<ComponentType<unknown> | null>(null);

  useEffect(() => {
    startTransition(() => {
      const LoadedComponent = lazy(() =>
        load()
          .then((Loaded) => ({
            default: () => children('default' in Loaded ? Loaded.default : Loaded),
          }))
          .catch((error: Error) => {
            console.error('Client side component loading failed:', error);

            return { default: () => <p>Failed to load client side component.</p> };
          }),
      );

      setComponent(LoadedComponent);
    });
  }, []);

  return Component ? <Component /> : fallback;
}

export default OnlyClient;
