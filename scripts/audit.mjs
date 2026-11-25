import { main } from './audit-gate.mjs';

// The entry point always runs the gate; the logic lives in audit-gate.mjs so tests can import it.
process.exitCode = main();
