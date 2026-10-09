import type { TimeEvidence } from '../../../shared/calendar';

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
export const timeEvidenceLabel = (evidence: TimeEvidence) => ({ manual: '수동 확인', official: '공식 공지',
  'schedule-rule': '일정 종료 규칙', 'version-update': '예정 점검 종료 후', 'version-cycle': '버전별 갱신 · 예정 점검 종료 후',
  'community-data': '공개 일정 · 시각 확인 필요' }[evidence.basis]);
