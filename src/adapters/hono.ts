import type { TSsrHandler } from '@core/types';

interface IHonoContext {
  req: {
    raw: Request;
  };
}

type THonoHandler = (context: IHonoContext) => Promise<Response>;

const adapterHono = (handler: TSsrHandler): THonoHandler => {
  return ({ req }) => handler(req.raw);
};

export type { IHonoContext, THonoHandler };

export default adapterHono;
