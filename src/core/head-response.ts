/**
 * Preserve GET metadata while releasing a body that cannot be sent for HEAD.
 */
const headResponse = async (request: Request, response: Response): Promise<Response> => {
  if (request.method !== 'HEAD' || !response.body) {
    return response;
  }

  await response.body.cancel();

  return new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export default headResponse;
