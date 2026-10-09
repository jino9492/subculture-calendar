export const apiUrl = (path: string, base = import.meta.env?.VITE_API_BASE_URL ?? ''): string => {
  const trimmed = base.trim();
  if (!trimmed) return path;
  const url = new URL(trimmed);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('VITE_API_BASE_URL에는 HTTP 또는 HTTPS 서버 주소를 지정해 주세요.');
  }
  return new URL(path, url.origin).href;
};
