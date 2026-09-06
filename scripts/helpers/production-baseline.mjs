import express from 'express';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
const app = express();

/**
 * Render one element with the same installed Express and React as the template.
 */
app.use((_request, response) => {
  const { pipe } = renderToPipeableStream(createElement('div', null, 'Production baseline'), {

    /**
     * Stream the completed shell through the ordinary Express response.
     */
    onShellReady() {
      response.type('html');
      pipe(response);
    },
  });
});

app.listen(Number(process.env.SSR_BOOST_ACCEPTANCE_PORT), '127.0.0.1');
