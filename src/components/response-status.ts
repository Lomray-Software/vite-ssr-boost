import type { FC } from 'react';
import { useServerContext } from '@context/server';

interface IStatusGate {
  status: number;
}

/**
 * Change server response status
 * Example: <ResponseStatus status={400} />
 * @constructor
 */
const ResponseStatus: FC<IStatusGate> = ({ status }) => {
  const context = useServerContext();

  if (context.isServer) {
    context.response = new Response('', { status });
  }

  return null;
};

export default ResponseStatus;
