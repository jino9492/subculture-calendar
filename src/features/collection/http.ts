export const fetchJson = async (url: URL): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
};

export const fetchHtml = async (url: URL) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`News HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 2000000) throw new Error('News document too large');
  return html;
};
