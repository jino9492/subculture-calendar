export const toKoreanInput = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 19);
export const fromKoreanInput = (text: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return null;
  const normalized = text.length === 16 ? `${text}:00` : text;
  const date = new Date(`${normalized}+09:00`);
  if (!Number.isFinite(date.getTime()) || toKoreanInput(date.toISOString()) !== normalized) return null;
  return date.toISOString();
};
export const koreanDate = (iso: string) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));
