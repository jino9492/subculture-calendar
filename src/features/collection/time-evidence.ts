import type { TimeEvidence } from '../../../shared/calendar';
import { parseLocalDate, type VersionBoundary } from './providers/parsers';

export const LOCAL_TIME_PATTERN = '\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?';
export const ZONED_TIME_PATTERN = `${LOCAL_TIME_PATTERN}(?:\\s*\\([^()]*\\))?`;

const explicitTime = (text: string, sourceUrl: string): TimeEvidence | undefined => {
  const time = new RegExp(LOCAL_TIME_PATTERN).exec(text)?.[0];
  if (!time) return undefined;
  const zone = /\(([^()]*)\)/.exec(text)?.[1]?.trim();
  if (zone && !/^(?:KST|한국\s*시간|UTC\s*\+\s*[89]|서버\s*시간)$/i.test(zone)) return undefined;
  // 각 경계의 시간대를 독립 해석하여 서버 시간과 한국 시간의 혼합 표기 처리
  const at = parseLocalDate(time, /KST|한국\s*시간|UTC\s*\+\s*9/i.test(zone ?? '') ? 9 : 8);
  return at ? { at, basis: 'official', precision: /:\d{2}:\d{2}$/.test(time) ? 'second' : 'minute', sourceUrl } : undefined;
};

export const parseHoyoTimeRange = (text: string, boundaries: VersionBoundary[], sourceUrl: string) => {
  const explicit = new RegExp(`(${ZONED_TIME_PATTERN})\\s*[-–~]\\s*(${ZONED_TIME_PATTERN})`).exec(text);
  if (explicit?.[1] && explicit[2]) {
    const start = explicitTime(explicit[1], sourceUrl), end = explicitTime(explicit[2], sourceUrl);
    return start && end && Date.parse(end.at) > Date.parse(start.at) ? { start, end } : undefined;
  }
  const relative = new RegExp(`(\\d+\\.\\d+)\\s*버전 업데이트 후\\s*[-–~]\\s*(${ZONED_TIME_PATTERN})`).exec(text);
  const boundary = boundaries.find((candidate) => candidate.version === relative?.[1]);
  const end = relative?.[2] ? explicitTime(relative[2], sourceUrl) : undefined;
  return boundary && end && Date.parse(end.at) > Date.parse(boundary.startAt)
    ? { start: { at: boundary.startAt, basis: 'version-update', precision: 'minute', sourceUrl } satisfies TimeEvidence, end }
    : undefined;
};
