'use client';

import { useEffect } from 'react';
import { DEFAULT_THEME, normalizeTheme, syncThemeChrome } from '@/lib/theme';

/** Synchronize browser chrome after Next has hydrated its document metadata. */
export function ThemeChrome() {
  useEffect(() => {
    const root = document.documentElement;
    const theme = normalizeTheme(root.getAttribute('data-theme')) || DEFAULT_THEME;
    syncThemeChrome(root, theme);
  }, []);

  return null;
}
