/** Preserve adapter targets before Fetch/WHATWG normalization, without retaining requests. */
const requestTargets = new WeakMap<Request, string>();

export default requestTargets;
