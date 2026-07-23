const splitLinkHeader = (header: string): string[] => {
  const links: string[] = [];
  let angleDepth = 0;
  let isEscaped = false;
  let isQuoted = false;
  let start = 0;

  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];

    if (isEscaped) {
      isEscaped = false;
    } else if (char === '\\' && isQuoted) {
      isEscaped = true;
    } else if (char === '"') {
      isQuoted = !isQuoted;
    } else if (!isQuoted && char === '<') {
      angleDepth += 1;
    } else if (!isQuoted && char === '>') {
      angleDepth = Math.max(0, angleDepth - 1);
    } else if (!isQuoted && angleDepth === 0 && char === ',') {
      links.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }

  links.push(header.slice(start).trim());

  return links.filter(Boolean);
};

export default splitLinkHeader;
