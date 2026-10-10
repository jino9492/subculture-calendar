import type { CalendarEvent } from '../../../../../shared/calendar';
import { parseLocalDate, DATE_PATTERN as DATE, type VersionBoundary } from '../../parsers';

export const endfieldWeaponPeriod = (text: string, version: VersionBoundary | undefined, banners: CalendarEvent[]) => {
  if (!/특별 허가 헤드헌팅/.test(text) || !/3회(?:의)?[\s\S]*종료/.test(text)) return null;
  const anchorName = /「([^」]+)」\s*(?:부터 집계|기준으로)/.exec(text)?.[1];
  const candidates = banners.filter((event) => event.game === 'endfield' && event.kind === 'banner'
    && /특별 허가 헤드헌팅/.test(event.title) && !/신청/.test(event.title));
  const namedAnchor = candidates.find((event) => anchorName && event.title.includes(`「${anchorName}」`));
  const explicitStart = new RegExp(DATE).exec(text)?.[0];
  const startAt = explicitStart ? parseLocalDate(explicitStart, 8)
    : /버전 업데이트 후/.test(text) ? version?.startAt : namedAnchor?.startAt;
  const anchor = anchorName ? namedAnchor : candidates.find((event) => startAt && Date.parse(event.startAt) === Date.parse(startAt));
  if (!startAt || !anchor || Date.parse(anchor.startAt) !== Date.parse(startAt)) return null;
  // 업데이트 공지와 개별 공지의 동일 캐릭터 픽업을 한 회차로 집계
  const cycles = [...new Map(candidates.filter((event) => Date.parse(event.startAt) >= Date.parse(startAt))
    .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt)).map((event) => [Date.parse(event.startAt), event])).values()]
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)).slice(0, 3);
  const last = cycles.at(-1);
  if (!last) return null;
  const estimated = cycles.length < 3;
  // 종료 직전 1분을 회차마다 빼지 않도록 달력 일수로 추정 간격 계산
  const cycleDays = Math.ceil((Date.parse(last.endAt) - Date.parse(last.startAt)) / 86400000);
  const endAt = estimated ? new Date(Date.parse(last.endAt)
    + (3 - cycles.length) * cycleDays * 86400000).toISOString() : last.endAt;
  return { startAt, endAt, estimated, sourceUrl: last.sourceUrl,
    note: `캐릭터 픽업 3회 기준: ${cycles.map((event) => event.title).join(' → ')}${estimated ? ` · 미공개 ${3 - cycles.length}회는 마지막 확인 픽업 기간으로 추정` : ''}` };
};
