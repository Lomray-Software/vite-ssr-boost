/**
 * Run every task, even after one threw synchronously, then throw the first failure.
 */
const settleAll = async (...tasks: (() => unknown)[]): Promise<void> => {
  const results = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)));
  const failure = results.find((result) => result.status === 'rejected');

  if (failure) {
    throw failure.reason;
  }
};

export default settleAll;
