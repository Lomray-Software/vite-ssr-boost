import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

interface IScrollToTop {
  shouldReloadReset?: boolean;
}

/**
 * Scroll page to top on every pathname (url) change
 * @constructor
 */
const ScrollToTop: FC<IScrollToTop> = ({ shouldReloadReset = false }) => {
  const { pathname } = useLocation();
  const prev = useRef(pathname);

  useEffect(() => {
    if (!shouldReloadReset && prev.current === pathname) {
      return;
    }

    prev.current = pathname;
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
