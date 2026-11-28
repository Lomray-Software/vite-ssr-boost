const diagnosticCode = /\b(SSR_BOOST_[A-Z0-9_]+)(?=:|\])/g;
// The hook follows the code after either delimiter: `CODE: hook` or `[CODE] hook`.
const hookName = /^[:\]]\s*([\w.]+)/;

// Parser states after the DEC VT500 model, reduced to what decides which text is printed.
const GROUND = 0;
const ESCAPE = 1;
const ESCAPE_INTERMEDIATE = 2;
const CONTROL_SEQUENCE = 3;
const OPERATING_SYSTEM_COMMAND = 4;
const CONTROL_STRING = 5;

// C1 introducers of DCS, SOS, PM and APC, and their ESC forms `P`, `X`, `^` and `_`.
const stringIntroducers = new Set([0x90, 0x98, 0x9e, 0x9f]);
const escapeStringIntroducers = new Set([0x50, 0x58, 0x5e, 0x5f]);

// Controls that move the cursor to another line: VT and FF; IND, NEL and RI; their ESC forms
// `D`, `E` and `M`, cursor restore `ESC 8` and reset `ESC c`; and the control
// sequences that move up, down or to a position (CUU, CUD, CNL, CPL, CUP, HVP, VPA, VPR, SCORC).
const lineControls = new Set([0x0b, 0x0c]);
const c1LineControls = new Set([0x84, 0x85, 0x8d]);
const escapeLineFinals = new Set([0x44, 0x45, 0x4d, 0x38, 0x63]);
const sequenceLineFinals = new Set([...'ABEFHdefu'].map((final) => final.charCodeAt(0)));
// Controls that move the cursor along the line: BS, and CUF, CUB, CHA, CHT, CBT, HPA and HPR.
const sequenceColumnFinals = new Set([...'CDGIZ`a'].map((final) => final.charCodeAt(0)));

/**
 * Whether a code point is a C0 control a terminal shows as space or a line end.
 */
const isShownControl = (code) => code === 0x09 || code === 0x0a || code === 0x0d;

/**
 * The state a C1 control leads to: a control sequence, a control string, or ground for the rest.
 */
const enterC1 = (code) => {
  if (code === 0x9b) return CONTROL_SEQUENCE;
  if (code === 0x9d) return OPERATING_SYSTEM_COMMAND;

  return stringIntroducers.has(code) ? CONTROL_STRING : GROUND;
};

/**
 * The text a terminal shows where a C0 control runs: tab, LF and CR as they are, a line end for VT
 * and FF, a space for BS, which moves along the line, and nothing for the rest.
 */
const showC0 = (char, code) => {
  if (isShownControl(code)) return char;
  if (lineControls.has(code)) return '\n';

  return code === 0x08 ? ' ' : '';
};

/**
 * The text a control sequence without private or intermediate bytes leaves in place of its
 * cursor move: a line end for a move to another line, a space for one along it, else nothing.
 */
const showSequence = (final) => {
  if (sequenceLineFinals.has(final)) return '\n';

  return sequenceColumnFinals.has(final) ? ' ' : '';
};

/**
 * The state after a printable byte that follows ESC.
 */
const afterEscape = (code) => {
  if (code === 0x5b) return CONTROL_SEQUENCE;
  if (code === 0x5d) return OPERATING_SYSTEM_COMMAND;
  if (escapeStringIntroducers.has(code)) return CONTROL_STRING;

  return code <= 0x2f ? ESCAPE_INTERMEDIATE : GROUND;
};

/**
 * Remove every terminal control from output, leaving only the text a terminal would print.
 * Sequences are parsed byte by byte as a terminal does, so CAN and SUB cancel one, ignored C0
 * bytes inside one leave it whole, and an unfinished one at the end of the output prints nothing.
 * A control that moves the cursor leaves a line end or a space, so text it separates on the screen
 * stays separate.
 */
const stripTerminalControls = (output) => {
  let text = '';
  let state = GROUND;
  // Whether the current control sequence has no private or intermediate bytes yet.
  let plainSequence = true;

  for (const char of output) {
    const code = char.codePointAt(0);

    // These act from every state, inside a control string too.
    if (code === 0x18 || code === 0x1a) {
      state = GROUND;
    } else if (code === 0x1b) {
      state = ESCAPE;
      plainSequence = true;
    } else if (code >= 0x80 && code <= 0x9f) {
      state = enterC1(code);
      plainSequence = true;
      if (c1LineControls.has(code)) text += '\n';
    } else if (state === OPERATING_SYSTEM_COMMAND || state === CONTROL_STRING) {
      // The payload never reaches the screen; BEL ends an OSC only, ST ends any string above.
      if (code === 0x07 && state === OPERATING_SYSTEM_COMMAND) state = GROUND;
    } else if (code < 0x20 || code === 0x7f) {
      // A terminal runs a C0 control without leaving a pending sequence and ignores DEL.
      if (code !== 0x7f) text += showC0(char, code);
    } else if (state === ESCAPE) {
      state = code <= 0x7e ? afterEscape(code) : GROUND;
      if (code > 0x7e) text += char;
      if (escapeLineFinals.has(code)) text += '\n';
    } else if (state === ESCAPE_INTERMEDIATE) {
      if (code >= 0x30) state = GROUND;
      if (code > 0x7e) text += char;
    } else if (state === CONTROL_SEQUENCE) {
      // Parameters and intermediates stay in the sequence; a final byte ends it.
      if (code >= 0x40) {
        state = GROUND;
        if (code <= 0x7e && plainSequence) text += showSequence(code);
      } else if (code <= 0x2f || code >= 0x3c) {
        plainSequence = false;
      }
      if (code > 0x7e) text += char;
    } else {
      text += char;
    }
  }

  return text;
};

/**
 * Classify every SSR_BOOST_ code in one process's output: policy lines are informational,
 * an Express hook deprecation is expected once per hook, and the rest are unexpected.
 */
const countDiagnostics = (output) => {
  const counts = { policyInfo: 0, expressHookDeprecations: 0, unexpected: 0, repeated: [] };
  const deprecations = new Set();

  // A control ends in a word character, which would defeat the boundary before a code.
  for (const line of stripTerminalControls(output).split('\n')) {
    for (const match of line.matchAll(diagnosticCode)) {
      const [marker, code] = match;

      if (code === 'SSR_BOOST_SSR_POLICY') {
        counts.policyInfo += 1;
      } else if (code === 'SSR_BOOST_DEPRECATED_EXPRESS_HOOK') {
        const detail = line.slice(match.index + marker.length);
        // Key by the hook, so text printed after the message on the same line cannot hide a repeat.
        const hook = hookName.exec(detail)?.[1] ?? detail;

        if (deprecations.has(hook)) counts.repeated.push(hook);
        deprecations.add(hook);
        counts.expressHookDeprecations += 1;
      } else {
        counts.unexpected += 1;
      }
    }
  }

  return counts;
};

export default countDiagnostics;
