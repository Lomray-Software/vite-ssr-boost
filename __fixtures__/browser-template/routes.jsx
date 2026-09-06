import React, { Suspense, useState } from 'react';
import { Await, Link, redirect, useLoaderData } from 'react-router';

const Shell = ({ children }) => {
  const [count, setCount] = useState(0);
  return (
    <main>
      <button onClick={() => setCount(count + 1)}>Count {count}</button>
      <Link to="/">Home</Link>
      <Link to="/deferred">Deferred</Link>
      <Link to="/spa">SPA</Link>
      <Link to="/public">Public</Link>
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
    path: '/footer',
    Component: () => <Shell><p>Footer hydration</p></Shell>,
  },
  {
    path: '/spa',
    loader: () => {
      if (typeof window === 'undefined') throw new Error('SPA loader executed on server');
      return 'Browser loader';
    },
    HydrateFallback: () => <p>Loading SPA</p>,
    Component: () => <Shell><h1>SPA page</h1><p>{useLoaderData()}</p></Shell>,
  },
  {
    path: '/spa-redirect',
    loader: () => {
      if (typeof window === 'undefined') throw new Error('SPA redirect executed on server');
      return redirect('/public');
    },
    HydrateFallback: () => <p>Redirecting</p>,
  },
  {
    path: '/public',
    loader: ({ request }) => typeof document === 'undefined' ? request.headers.get('cookie') : document.cookie,
    Component: () => <Shell><h1>Public page</h1><p data-cookie>{useLoaderData() || 'No cookie'}</p></Shell>,
  },
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
