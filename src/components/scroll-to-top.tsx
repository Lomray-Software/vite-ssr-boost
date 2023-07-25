import type { FC } from 'react';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scroll page to top on every pathname (url) change
 * @constructor
 */
const ScrollToTop: FC = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
