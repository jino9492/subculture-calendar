import { isImageUrl, isRecord, type CalendarEvent, type GameId } from '../../../shared/calendar';
import type { CollectionIssue } from '../../../shared/admin';
import { parseLocalDate } from './parsers';
import { fetchJson } from './http';
import { attachHoyoNames } from './hoyo/names';
import { translateScheduleNames, type KoreanNames } from './names';
import type { Announcement } from './hoyo/announcements';
import { STAR_RAIL_CHALLENGE_PREFIXES } from './starrail/custom/names';
import { ZENLESS_NAMES } from './zenless/custom/names';

export const SRA_GAMES = { genshin: 'ys', starrail: 'sr', zenless: 'zzz', endfield: 'end' };

export const structuredDate = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const explicit = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (explicit) {
    const time = Date.parse(value);
    const offset = explicit[2] === 'Z' ? 0 : (Number(explicit[4]) * 60 + Number(explicit[5])) * (explicit[3] === '-' ? -1 : 1);
    return Number.isFinite(time) && new Date(time + offset * 60000).toISOString().slice(0, 19) === explicit[1]
      ? new Date(time).toISOString() : null;
  }
  // 공개 피드의 오프셋 없는 서버 시각은 Asia UTC+8 프로필로 해석
  return parseLocalDate(value.replace('T', ' '), 8);
};

export const learnStructuredActivityNames = (game: Exclude<GameId, 'wuwa' | 'endfield'>, original: unknown, names: KoreanNames,
  koreanAnnouncements: Announcement[] = [], originalAnnouncements: Announcement[] = []): KoreanNames => {
  const linked = isRecord(original) ? attachHoyoNames(game, original, names, 'ko-kr') : {};
  const result = { ...names };
  const linkedIdentities = new Map<string, Set<string>>();
  const linkName = (title: string, name: KoreanNames[string], identityKey: string) => {
    const key = `sra:${game}:event:${encodeURIComponent(title)}`;
    const identities = linkedIdentities.get(key) ?? new Set<string>();
    identities.add(identityKey);
    linkedIdentities.set(key, identities);
    result[key] = { ...name, identityKey: identities.size === 1 ? identityKey : undefined };
  };
  for (const item of (Array.isArray(linked.events) ? linked.events : []).filter(isRecord)) {
    if (typeof item.name !== 'string' || typeof item.localization_key !== 'string') continue;
    const name = names[item.localization_key];
    if (name) linkName(item.name, name, item.localization_key);
  }
  const challengeTypes = STAR_RAIL_CHALLENGE_PREFIXES;
  for (const item of (Array.isArray(linked.challenges) ? linked.challenges : []).filter(isRecord)) {
    if (typeof item.name !== 'string' || typeof item.localization_key !== 'string' || typeof item.type_name !== 'string') continue;
    const name = names[item.localization_key];
    const prefix = challengeTypes[item.type_name];
    if (name && prefix) linkName(`${prefix}: ${item.name}`, { ...name, kind: 'challenge' }, item.localization_key);
  }
  const pairs = new Map<string, Map<string, string>>();
  const sections = (article: Announcement) => {
    const lines = article.description.split('\n').map((line) => line.trim()).filter(Boolean);
    const headers = lines.flatMap((line, index) => /^■\s*\S/.test(line) ? [index] : []);
    return headers.map((index, position) => {
      const body = lines.slice(index + 1, headers[position + 1] ?? lines.length);
      const period = body.filter((line) => /^(?:개방|수령|이벤트|워프|기원|채널)\s*(?:기간|시간)|^(?:Availability|Claim Period|Event Period|Duration)[:：]/i.test(line)).join(' ');
      return { title: (lines[index] ?? '').replace(/^■\s*/, ''),
        dates: [...body.join(' ').matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/g)].map((match) => parseLocalDate(match[0], 9)),
        versions: [...period.matchAll(/\d+\.\d+/g)].map((match) => match[0]) };
    });
  };
  const addPair = (originalTitle: string, koreanTitle: string, url: string) => {
    const key = `sra:${game}:event:${encodeURIComponent(originalTitle)}`;
    const candidates = pairs.get(key) ?? new Map();
    candidates.set(koreanTitle, url);
    pairs.set(key, candidates);
  };
  for (const english of originalAnnouncements) {
    const korean = koreanAnnouncements.find((article) => article.id === english.id);
    if (!korean) continue;
    const enSections = sections(english);
    const koSections = sections(korean);
    if (enSections.length === koSections.length) for (const [index, en] of enSections.entries()) {
      const ko = koSections[index];
      if (ko && (en.dates.length >= 1 || en.versions.length >= 1) && JSON.stringify(en.dates) === JSON.stringify(ko.dates)
        && JSON.stringify(en.versions) === JSON.stringify(ko.versions) && /[가-힣]/.test(ko.title))
        addPair(en.title, ko.title, korean.url);
    }
    const originalTitle = /"([^"]+)"|「([^」]+)」/.exec(english.title)?.slice(1).find(Boolean);
    const koreanTitle = /「([^」]+)」|"([^"]+)"/.exec(korean.title)?.slice(1).find(Boolean);
    if (!originalTitle || !koreanTitle || !/[가-힣]/.test(koreanTitle)) continue;
    addPair(originalTitle, koreanTitle, korean.url);
  }
  // 동일 공지 ID로 확인된 유일한 이름 대응만 연결
  for (const [key, candidates] of pairs) if (candidates.size === 1 && !result[key]) {
    const entry = [...candidates][0];
    if (entry) result[key] = { title: entry[0], sourceUrl: entry[1] };
  }
  return result;
};

export const parseStructuredActivities = (raw: unknown, sourceUrl: string, game: Exclude<GameId, 'wuwa'> = 'zenless', names: KoreanNames = {}) => {
  if (!isRecord(raw) || !Array.isArray(raw.activities)) throw new Error('Invalid activity calendar');
  const events: CalendarEvent[] = [];
  const issues: CollectionIssue[] = [];
  for (const [index, item] of raw.activities.entries()) {
    if (!isRecord(item) || typeof item.name !== 'string') {
      issues.push({ id: `sra:${game}:invalid:${index}`, game, title: '이벤트 형식 확인', reason: '원본 구조화 이벤트의 제목·형식 확인 필요', sourceUrl, excerpt: '' });
      continue;
    }
    const startAt = structuredDate(item.startTime);
    const endAt = structuredDate(item.endTime);
    const title = game === 'zenless' && Object.hasOwn(ZENLESS_NAMES, item.name) ? ZENLESS_NAMES[item.name] : undefined;
    const key = `sra:${game}:event:${encodeURIComponent(String(item.id ?? item.name))}`;
    const learnedName = names[key] ?? names[`sra:${game}:event:${encodeURIComponent(item.name)}`];
    if (!startAt || !endAt || endAt <= startAt || Date.parse(endAt) - Date.parse(startAt) > 365 * 86400000) {
      issues.push({ id: `${key}:period`, game, title: '이벤트 기간 확인', reason: '원본 구조화 이벤트의 시작·종료 시각 확인 필요', sourceUrl, excerpt: item.name });
      continue;
    }
    const translated = translateScheduleNames([{ id: `${key}:${startAt}`, game, kind: learnedName?.kind ?? 'event', title: item.name, startAt, endAt,
      sourceUrl, sourceLanguage: 'en-us', localizationKey: key, collectionMethod: 'structured',
      ...(isImageUrl(item.cover) ? { imageUrls: [item.cover] } : {}),
      periodBasis: 'community-data', description: '원본 구조화 이벤트 기간 · 명시 시차 우선, 시차 없는 시각은 Asia UTC+8 기준' }],
      { ...(title ? { [key]: { title, sourceUrl } } : {}), ...names,
        ...(learnedName ? { [key]: learnedName } : {}) });
    events.push(...translated.events.map((event) => ({ ...event, timeEvidence: {
      start: { at: event.startAt, basis: 'community-data' as const, precision: 'second' as const, sourceUrl },
      end: { at: event.endAt, basis: 'community-data' as const, precision: 'second' as const, sourceUrl },
    } })));
    issues.push(...translated.issues);
  }
  return { events, issues };
};

export const supplementStructuredVersion = (events: CalendarEvent[], raw: unknown, sourceUrl: string, game: Exclude<GameId, 'wuwa'>) => {
  if (!isRecord(raw) || typeof raw.version !== 'string' || !/^\d+\.\d+$/.test(raw.version) || !Array.isArray(raw.activities)) throw new Error('Invalid activity calendar');
  const startAt = structuredDate(raw.startTime);
  const endAt = structuredDate(raw.endTime);
  if (!startAt || !endAt || endAt <= startAt || Date.parse(endAt) - Date.parse(startAt) > 100 * 86400000) throw new Error('Invalid structured version period');
  const match = events.find((event) => event.game === game && event.kind === 'version'
    && (game === 'endfield' || event.title === `버전 ${raw.version}`)
    && Date.parse(event.startAt) >= Date.parse(startAt) && Date.parse(event.startAt) - Date.parse(startAt) <= 6 * 3600000);
  if (!match || match.sourceLanguage === 'ko-kr' && match.periodBasis === 'community-data'
    || match.versionEndBasis === 'official' || match.versionEndBasis === 'next-maintenance' || match.versionEndBasis === 'manual') return events;
  return events.map((event) => {
    if (event.id !== match.id) return event;
    const next = { ...event, endAt, sourceUrl, sourceLanguage: 'en-us', displayLanguage: 'ko-kr' as const,
      periodBasis: 'community-data' as const, versionEndSourceUrl: sourceUrl,
      description: '원본 공개 구조화 버전 종료를 Asia 시각으로 변환. 버전 시작은 대조된 공식 한국어 개방 시각 기준.' };
    delete next.versionEndBasis;
    return next;
  });
};

export const fetchStructuredVersion = async (game: Exclude<GameId, 'wuwa'>) => {
  const url = new URL(`activity/${SRA_GAMES[game]}-en-US.json`, process.env.SRA_API_BASE ?? 'https://starrailassistant.top/api/v1/');
  try { return { raw: await fetchJson(url), sourceUrl: url.href }; }
  catch (error) { console.error(`[${game}] original version API unavailable`, error); return null; }
};
