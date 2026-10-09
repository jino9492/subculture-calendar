import { useState } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'subculture-calendar-theme';

const readTheme = (): Theme => {
  try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
};

export const initializeTheme = () => {
  document.documentElement.dataset.theme = readTheme();
};

export const ThemeToggle = () => {
  const [theme, setTheme] = useState(readTheme);
  const handleToggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); }
    catch { console.warn('화면 모드 설정을 브라우저에 저장하지 못했습니다.'); }
  };
  return <button type="button" className="small-button" aria-label="다크 모드" aria-pressed={theme === 'dark'} onClick={handleToggle}>
    {theme === 'light' ? '☾ 다크 모드' : '☀ 라이트 모드'}
  </button>;
};
