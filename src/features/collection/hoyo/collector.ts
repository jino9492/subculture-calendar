import type { GameId } from '../../../../shared/calendar';
import { buildVersionEvents, type VersionBoundary } from '../parsers';
import { parseHoyoCalendar, parseHoyoVersions } from './parsers';
import { hoyoAnnouncementUrl, parseHoyoAnnouncements, supplementHoyoCalendar } from './announcements';
import { attachHoyoNames } from './names';
import { loadKoreanNames, rememberKoreanNames, learnKoreanScheduleNames } from '../names';
import { mergeHoyoStructured } from './priority';
import { fetchJson } from '../http';
import { fetchStructuredVersion, supplementStructuredVersion, parseStructuredActivities, learnStructuredActivityNames } from '../sra';

export const fetchHoyo = async (game: Exclude<GameId, 'wuwa' | 'endfield'>) => {
  const structuredVersion = await fetchStructuredVersion(game);
  const base = process.env.HOYO_API_BASE ?? 'https://api.ennead.cc/mihoyo/';
  let calendarUrl = new URL(`${game}/calendar?lang=ko-kr`, base);
  const names = await loadKoreanNames(game);
  let language: 'ko-kr' | 'en-us' = 'ko-kr';
  let structuredRepaired = 0;
  let originalCalendar: unknown;
  let parsed: ReturnType<typeof parseHoyoCalendar>;
  try {
    const korean = await fetchJson(calendarUrl);
    parsed = parseHoyoCalendar(game, attachHoyoNames(game, korean, names, language), calendarUrl.href);
    try {
      const originalUrl = new URL(`${game}/calendar?lang=en-us`, base);
      originalCalendar = await fetchJson(originalUrl);
      const supplemented = mergeHoyoStructured(game, korean, originalCalendar, calendarUrl.href, originalUrl.href, names);
      parsed = supplemented;
      structuredRepaired = supplemented.repaired;
    } catch (error) { console.error(`[${game}] structured supplement unavailable`, error); }
  }
  catch (error) {
    console.error(`[${game}] Korean calendar unavailable, trying structured fallback`, error);
    language = 'en-us';
    calendarUrl = new URL(`${game}/calendar?lang=en-us`, base);
    parsed = parseHoyoCalendar(game, attachHoyoNames(game, await fetchJson(calendarUrl), names, language), calendarUrl.href, language);
  }
  let supplementaryFailed = false;
  let announcements: ReturnType<typeof parseHoyoAnnouncements> = [];
  let originalAnnouncements: ReturnType<typeof parseHoyoAnnouncements> = [];
  let versions: VersionBoundary[] = [];
  try {
    const announcementUrl = hoyoAnnouncementUrl(game);
    announcements = parseHoyoAnnouncements(await fetchJson(announcementUrl), announcementUrl.href);
    versions = parseHoyoVersions(announcements);
    try {
      const originalUrl = hoyoAnnouncementUrl(game, 'en-us');
      originalAnnouncements = parseHoyoAnnouncements(await fetchJson(originalUrl), originalUrl.href, 'en-us');
    } catch (error) { console.error(`[${game}] bilingual announcement names unavailable`, error); }
  } catch (error) { supplementaryFailed = true; console.error(`[${game}] official announcements unavailable`, error); }
  try {
    const notices = await fetchJson(new URL(`${game}/news/notices?lang=ko-kr`, base));
    let noticeVersions = parseHoyoVersions(notices);
    const latest = [...versions, ...noticeVersions].sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
    if (!latest?.endAt) {
      const extra = await Promise.allSettled(['info', 'events'].map((category) => fetchJson(new URL(`${game}/news/${category}?lang=ko-kr`, base))));
      const articles: unknown[] = Array.isArray(notices) ? [...notices] : [];
      for (const result of extra) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) articles.push(...result.value);
        else { supplementaryFailed = true; console.error(`[${game}] supplementary version source unavailable`); }
      }
      noticeVersions = parseHoyoVersions(articles);
    }
    const merged = new Map(versions.map((boundary) => [boundary.version, boundary]));
    for (const boundary of noticeVersions) {
      const previous = merged.get(boundary.version);
      merged.set(boundary.version, previous?.endAt && !boundary.endAt ? previous : boundary);
    }
    versions = [...merged.values()];
  } catch (error) {
    console.error(`[${game}] version notices unavailable`, error);
    supplementaryFailed = true;
  }
  if (structuredVersion) {
    try {
      const dictionary = learnStructuredActivityNames(game, originalCalendar, learnKoreanScheduleNames(parsed.events, names), announcements, originalAnnouncements);
      const supplementary = parseStructuredActivities(structuredVersion.raw, structuredVersion.sourceUrl, game, dictionary);
      parsed.events = [...parsed.events, ...supplementary.events];
      parsed.issues.push(...supplementary.issues);
      try { await rememberKoreanNames(game, supplementary.events); }
      catch (error) { console.error(`[${game}] supplementary names save failed`, error); }
    } catch (error) { supplementaryFailed = true; console.error(`[${game}] original activity validation failed`, error); }
  }
  parsed = supplementHoyoCalendar(game, parsed, announcements, versions);
  parsed.events.push(...buildVersionEvents(game, versions));
  if (structuredVersion) {
    try { parsed.events = supplementStructuredVersion(parsed.events, structuredVersion.raw, structuredVersion.sourceUrl, game); }
    catch (error) { console.error(`[${game}] original version validation failed`, error); }
  }
  try { await rememberKoreanNames(game, parsed.events); }
  catch (error) { console.error(`[${game}] Korean names save failed`, error); }
  const versionFailed = versions.length === 0;
  const defaultVersions = parsed.events.filter((event) => event.versionEndBasis === 'default-42-days').length;
  return { ...parsed, partial: language !== 'ko-kr' || versionFailed || supplementaryFailed || defaultVersions > 0 || parsed.skipped > 0 || parsed.issues.length > 0,
    message: `${language === 'en-us' ? '영문 구조화 API를 저장된 한국어 이름으로 변환. ' : '한국어 구조화 API 우선 · 누락은 원본 구조화 API 대조 후 공식 공지 보완. '}${structuredRepaired ? `${structuredRepaired}개 원본 구조화 기간 보완. ` : ''}${parsed.skipped ? `기간이 없는 ${parsed.skipped}개 항목 제외. ` : ''}${versionFailed ? '버전 시작 정보 수집 누락. ' : ''}${defaultVersions ? `${defaultVersions}개 버전은 종료 시각 수집 누락으로 42일 기본값 적용. ` : ''}${supplementaryFailed ? '보완 공지 수집 실패. ' : ''}제공된 현재·예정 일정만 표시.` };
};
