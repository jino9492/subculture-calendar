import { CONTENTS, WEEKLY_CONTENTS } from './custom/contents';
import { isImageUrl, isRecord, type CalendarEvent, type EventKind } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { translateScheduleNames, type KoreanNames } from '../names';

export const WUWA_PUBLIC_EVENTS_URL = 'https://raw.githubusercontent.com/Sanma5657/wuwa-wiki-public/main/events.json';
const wuwaImageUrl = (value: unknown) => {
  if (isImageUrl(value)) return value;
  if (typeof value !== 'string' || !/^(?:Ui[A-Za-z0-9_-]+|Common)(?:\/[A-Za-z0-9_-]+)+$/.test(value)) return undefined;
  const base = process.env.WUWA_WIKI_IMAGE_BASE
    ?? 'https://static-cloudflare-f8p1t7z8.wutheringwaves.wiki/transform/kuro/gameclient/Content/Aki/UI/UIResources/';
  if (!isImageUrl(base)) return undefined;
  return new URL(`${value}.avif`, base.endsWith('/') ? base : `${base}/`).href;
};



const dateTime = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  const time = Date.parse(value);
  if (!match || !Number.isFinite(time)) return null;
  const offset = match[2] === 'Z' ? 0 : (Number(match[4]) * 60 + Number(match[5])) * (match[3] === '-' ? -1 : 1);
  return new Date(time + offset * 60000).toISOString().slice(0, 19) === match[1] ? time : null;
};

export const wuwaAsiaIndex = (servers: unknown) => {
  if (!Array.isArray(servers)) throw new Error('Invalid server list');
  const index = servers.findIndex((server) => isRecord(server) && typeof server.label === 'string'
    && /(?:^|\/)Asia(?:\/|$)/.test(server.label) && server.utc === '+8');
  if (index < 0) throw new Error('Asia schedule unavailable');
  return index;
};

const periodFrom = (time: unknown, serverIndex: number) => {
  if (!Array.isArray(time) || !Array.isArray(time[serverIndex])) return null;
  const values: unknown[] = time[serverIndex];
  const start = dateTime(values[0]);
  const rawEnd = dateTime(values[1]);
  const end = rawEnd === null ? null : rawEnd + (typeof values[1] === 'string' && /:59\.999(?:Z|[+-]\d{2}:\d{2})$/.test(values[1]) ? 1 : 0);
  return start !== null && end !== null && end > start ? { start, end } : null;
};

export const parseWuwaStructuredCalendar = (raw: unknown, calendar: unknown, sourceUrl: string, names: KoreanNames = {}, language: 'ko-kr' | 'und' = 'ko-kr', now = Date.now()) => {
  if (!isRecord(raw) || !Array.isArray(raw.list) || !isRecord(calendar) || !Array.isArray(calendar.versions)) throw new Error('Invalid structured calendar');
  const serverIndex = wuwaAsiaIndex(raw.servers);
  const events: CalendarEvent[] = [];
  const issues: CollectionIssue[] = [];
  const dictionary = { ...names };
  let skipped = 0;
  for (const group of raw.list.filter(isRecord)) {
    if (!Array.isArray(group.child)) continue;
    if (group.id !== 1 && group.id !== 2 && group.id !== 3 && group.id !== 4) {
      skipped += group.child.length;
      issues.push({ id: `wuwa:structured:group:${String(group.id)}`, game: 'wuwa', title: '신규 일정 분류 확인',
        reason: '원본 구조화 API에 새 분류가 추가되었습니다. 일정 종류 확인 필요', sourceUrl, excerpt: `분류 ID: ${String(group.id)}, 항목 수: ${group.child.length}` });
      continue;
    }
    if (group.id === 3) continue;
    const groupUrl = typeof group.sourceUrl === 'string' && /^https:\/\//.test(group.sourceUrl) ? group.sourceUrl : sourceUrl;
    for (const row of group.child.filter(isRecord)) {
      if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id)) { skipped++; continue; }
      // 상시 개방에는 종료일을 만들지 않고 기간 일정과 분리
      if (group.id === 4) continue;
      const kind: EventKind = group.id === 1 ? 'banner' : 'event';
      const key = `wuwa:wiki:${kind}:${row.id}`;
      if (language === 'ko-kr' && typeof row.title === 'string' && /[가-힣]/.test(row.title)) dictionary[key] = { title: row.title, sourceUrl: groupUrl };
      const period = periodFrom(row.time, serverIndex);
      if (!period) {
        skipped++;
        issues.push({ id: `wuwa:structured:period:${row.id}`, game: 'wuwa', title: dictionary[key]?.title ?? '일정 기간 확인',
          reason: '구조화 원본의 Asia 시작·종료 기간 미수집.', sourceUrl: groupUrl, excerpt: `콘텐츠 ID: ${row.id}` });
        continue;
      }
      if (period.end <= now - 100 * 86400000) continue;
      const imageUrl = wuwaImageUrl(row.tabImg);
      const translated = translateScheduleNames([{ id: `wuwa:wiki:${kind}:${row.id}`, game: 'wuwa', kind,
        title: typeof row.title === 'string' ? row.title : String(row.id), localizationKey: key, collectionMethod: 'structured',
        startAt: new Date(period.start).toISOString(), endAt: new Date(period.end).toISOString(), sourceUrl: groupUrl,
        ...(imageUrl ? { imageUrls: [imageUrl] } : {}),
        sourceLanguage: language, periodBasis: 'community-data', description: '공개 구조화 API의 Asia 명시 기간 기준.' }], dictionary);
      events.push(...translated.events);
      issues.push(...translated.issues);
    }
  }
  const versionPeriods = new Map<string, Map<string, { start: number; end: number }>>();
  for (const row of calendar.versions.filter(isRecord)) {
    const match = typeof row.devTitle === 'string' ? /^ver_(\d+\.\d+)_(1st|2nd)_half$/.exec(row.devTitle) : null;
    const period = periodFrom(row.time ?? row.value, serverIndex);
    if (!match?.[1] || !match[2] || !period) continue;
    const halves = versionPeriods.get(match[1]) ?? new Map();
    halves.set(match[2], period);
    versionPeriods.set(match[1], halves);
  }
  for (const [version, halves] of versionPeriods) {
    const first = halves.get('1st');
    const second = halves.get('2nd');
    if (!first || !second || first.end !== second.start || second.end <= now - 100 * 86400000) continue;
    events.push({ id: `wuwa:version:${version}`, game: 'wuwa', kind: 'version', title: `버전 ${version}`,
      startAt: new Date(first.start).toISOString(), endAt: new Date(second.end).toISOString(), sourceUrl,
      collectionMethod: 'structured', sourceLanguage: language, displayLanguage: 'ko-kr', periodBasis: 'community-data',
      description: '공개 구조화 API의 전반·후반 명시 기간을 합친 버전 기간. 공식 점검 시각 확인 시 보정 가능합니다.' });
  }
  const challengeRows = raw.list.filter(isRecord).flatMap((group) => Array.isArray(group.child) ? group.child.filter(isRecord) : [])
    .flatMap((row) => { const content = CONTENTS.find((item) => item.sourceId === row.sourceId); return content ? [{ ...row, path: content.path }] : []; });
  const challenges = parseWuwaPublicChallenges({ servers: raw.servers, list: [{ child: challengeRows }] }, sourceUrl, dictionary, now);
  events.push(...challenges.events.map((event) => ({ ...event, sourceLanguage: language })));
  issues.push(...challenges.issues);
  for (const group of raw.list.filter(isRecord)) {
    if (group.id !== 3 || !Array.isArray(group.child)) continue;
    for (const row of group.child.filter(isRecord)) {
      if (CONTENTS.some((content) => content.sourceId === row.sourceId)) continue;
      const weekly = WEEKLY_CONTENTS.find((content) => content.sourceId === row.sourceId);
      const kind: EventKind = weekly ? 'weekly' : 'challenge';
      const key = `wuwa:wiki:challenge:${String(row.sourceId ?? row.id)}`;
      if (weekly && !dictionary[key]) dictionary[key] = { title: weekly.name, sourceUrl };
      if (language === 'ko-kr' && typeof row.title === 'string' && /[가-힣]/.test(row.title)) dictionary[key] = { title: row.title, sourceUrl };
      let period = periodFrom(row.time, serverIndex);
      const time = Array.isArray(row.time) && Array.isArray(row.time[serverIndex]) ? row.time[serverIndex] : [];
      const anchor = dateTime(time[0]);
      const weeks = isRecord(row.season) && isRecord(row.season.cycle) ? row.season.cycle.weeks : undefined;
      const recurring = time.length === 1 && anchor !== null && typeof weeks === 'number' && Number.isInteger(weeks) && weeks >= 1 && weeks <= 12;
      if (recurring) {
        const duration = weeks * 7 * 86400000;
        const start = anchor + Math.max(0, Math.floor((now - anchor) / duration)) * duration;
        period = { start, end: start + duration };
      }
      if (!period || typeof row.id !== 'number' || !Number.isSafeInteger(row.id)) {
        skipped++;
        issues.push({ id: `${key}:period`, game: 'wuwa', title: dictionary[key]?.title ?? '엔드콘텐츠 기간 확인',
          reason: '신규 엔드콘텐츠의 Asia 명시 기간 또는 반복 주기 확인 필요', sourceUrl, excerpt: String(row.title ?? row.id) });
        continue;
      }
      if (period.end <= now - 100 * 86400000) continue;
      const imageUrl = wuwaImageUrl(row.tabImg);
      const translated = translateScheduleNames([{ id: `${key}:${period.end}`, game: 'wuwa', kind,
        title: String(row.title ?? row.id), localizationKey: key, startAt: new Date(period.start).toISOString(), endAt: new Date(period.end).toISOString(),
        sourceUrl, sourceLanguage: language, periodBasis: recurring ? 'community-cycle' : 'community-data',
        collectionMethod: 'structured',
        ...(imageUrl ? { imageUrls: [imageUrl] } : {}), description: `구조화 API에 명시된 ${weekly ? '주간콘텐츠' : '신규 엔드콘텐츠'} 기간·주기 기준` }], dictionary);
      events.push(...translated.events);
      issues.push(...translated.issues);
    }
  }
  return { events, issues, skipped, missing: challenges.missing };
};

export const parseWuwaPublicChallenges = (raw: unknown, sourceUrl: string, names: KoreanNames = {}, now = Date.now()) => {
  if (!isRecord(raw) || !Array.isArray(raw.servers) || !Array.isArray(raw.list) || !/^https:\/\//.test(sourceUrl) || !Number.isFinite(now)) throw new Error('Unexpected public schedule schema');
  const serverIndex = raw.servers.findIndex((server) => isRecord(server) && typeof server.label === 'string'
    && /(?:^|\/)Asia(?:\/|$)/.test(server.label) && server.utc === '+8');
  if (serverIndex < 0) throw new Error('Asia schedule unavailable');
  const rows = raw.list.filter(isRecord).flatMap((group) => Array.isArray(group.child) ? group.child.filter(isRecord) : []);
  const missing: string[] = [];
  const events = [];
  const issues = [];
  for (const content of CONTENTS) {
    const candidates = rows.filter((row) => row.path === content.path && row.sourceId === content.sourceId);
    const periods = candidates.flatMap((row) => {
      if (!Array.isArray(row.time) || typeof row.id !== 'number' || !Number.isSafeInteger(row.id)) return [];
      const times = row.time[serverIndex];
      if (!Array.isArray(times)) return [];
      const anchor = dateTime(times[0]);
      if (anchor === null || anchor > now) return [];
      const cycle = isRecord(row.season) && isRecord(row.season.cycle) ? row.season.cycle : undefined;
      const weeks = cycle?.weeks;
      const isRecurring = times.length === 1;
      if (isRecurring && (typeof weeks !== 'number' || !Number.isInteger(weeks) || weeks < 1 || weeks > 12)) return [];
      const duration = typeof weeks === 'number' ? weeks * 7 * 86400000 : 0;
      const start = isRecurring ? anchor + Math.floor((now - anchor) / duration) * duration : anchor;
      const rawEnd = dateTime(times[1]);
      // 포함형 종료 시각을 연속 기간의 종료 경계로 통일
      const end = isRecurring ? start + duration : rawEnd === null ? null : rawEnd + (typeof times[1] === 'string' && times[1].includes(':59.999') ? 1 : 0);
      if (end === null || end <= start || end <= now) return [];
      return [{ rowId: row.id, start, end, isRecurring, weeks, imageUrl: wuwaImageUrl(row.tabImg) }];
    }).sort((a, b) => b.start - a.start);
    const period = periods[0];
    if (!period) { missing.push(content.name); continue; }
    const key = `wuwa:wiki:${content.key}`;
    const translated = translateScheduleNames([{ id: `wuwa:challenge:${content.key}:${new Date(period.end).toISOString()}`,
      game: 'wuwa', kind: 'challenge', title: content.path, localizationKey: key,
      startAt: new Date(period.start).toISOString(), endAt: new Date(period.end).toISOString(),
      sourceUrl, sourceLanguage: 'und', periodBasis: period.isRecurring ? 'community-cycle' : 'community-data',
      ...(period.imageUrl ? { imageUrls: [period.imageUrl] } : {}),
      description: period.isRecurring ? `공개 Asia 일정의 ${period.weeks}주 반복 규칙 기준. 원본 데이터 갱신 시 기간도 다시 계산합니다.`
        : '공개 Asia 일정에 명시된 현재 주기의 시작·종료 기준.' }],
    { [key]: { title: content.name, sourceUrl }, ...names });
    events.push(...translated.events);
    issues.push(...translated.issues);
  }
  return { events, issues, missing };
};
