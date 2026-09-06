import React, { Suspense, useState } from 'react';
import { Await, Link, useLoaderData } from 'react-router';

const Shell = ({ children }) => {
  const [count, setCount] = useState(0);
  return (
    <main>
      <button onClick={() => setCount(count + 1)}>Count {count}</button>
      <Link to="/">Home</Link>
      <Link to="/deferred">Deferred</Link>
      {children}
    </main>
  );
};
const UseContent = ({ promise }) => <p data-resolved>Users: {React.use(promise).users}</p>;
const Deferred = () => {
  const data = useLoaderData();
  return (
    <Shell>
      <h1>{data.title}</h1>
      <Suspense fallback={<p data-fallback>Loading users</p>}>
        {data.use ? (
          <UseContent promise={data.slow} />
        ) : (
          <Await resolve={data.slow} errorElement={<p data-error>Could not load users</p>}>
            {(value) => <p data-resolved>Users: {value.users}</p>}
          </Await>
        )}
      </Suspense>
    </Shell>
  );
};
export const routes = [
  {
    path: '/',
    Component: () => (
      <Shell>
        <p>Home</p>
      </Shell>
    ),
  },
  {
    path: '/deferred',
    Component: Deferred,
    loader: ({ request }) => ({
      title: 'Deferred',
      use: new URL(request.url).searchParams.has('use'),
      slow: fetch(new URL('/api/slow', request.url), { signal: request.signal }).then((response) =>
        response.json(),
      ),
    }),
  },
];
export const App = ({ children }) => <>{children}</>;
