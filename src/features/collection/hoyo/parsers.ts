import { isImageUrl, isRecord, type CalendarEvent, type EventKind, type GameId } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { createHash } from 'node:crypto';
import { parseLocalDate, parseVersionEnd, stripHtml, DATE_PATTERN, type VersionBoundary } from '../parsers';
import { formatStarrailChallengeTitle } from '../starrail/custom/names';
import { isGenshinHardChallenge } from '../genshin/custom/classification';

const unixDate = (value: unknown): string | null => {
  if (typeof value !== 'number' || value <= 0 || value > 4102444800) return null;
  return new Date(value * 1000).toISOString();
};

const collectNames = (value: unknown): string[] => Array.isArray(value)
  ? value.filter(isRecord).filter((item) => item.rarity === 5 || item.rarity === '5' || item.rarity === 'S')
    .flatMap((item) => typeof item.name === 'string' ? [item.name] : []) : [];

export const parseHoyoCalendar = (game: Exclude<GameId, 'wuwa' | 'endfield'>, data: unknown, sourceUrl: string, sourceLanguage: 'ko-kr' | 'en-us' = 'ko-kr') => {
  if (!isRecord(data) || !Array.isArray(data.events) || !Array.isArray(data.banners) || !Array.isArray(data.challenges)) {
    throw new Error('Unexpected calendar schema');
  }
  const events: CalendarEvent[] = [];
  const issues: CollectionIssue[] = [];
  let skipped = 0;
  const groups: [string, EventKind][] = [['events', 'event'], ['banners', 'banner'], ['challenges', 'challenge']];
  for (const [key, kind] of groups) {
    const items = data[key];
    if (!Array.isArray(items)) continue;
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) { skipped++; issues.push({ id: `${game}:${key}:invalid:${index}`, game, title: `${key} · ${index + 1}번째 항목`, reason: '공지 데이터 형식 확인 필요', sourceUrl, excerpt: '' }); continue; }
      const startAt = unixDate(item.start_time);
      const endAt = unixDate(item.end_time);
      const names = ['characters', 'weapons', 'light_cones', 'agents', 'w_engines'].flatMap((field) => collectNames(item[field]));
      let title = kind === 'banner' && names.length ? names.join(' · ')
        : typeof item.name === 'string' && item.name.trim() ? item.name : '';
      title = title.replace(/\s+/g, ' ').trim();
      if (game === 'starrail' && kind === 'challenge') title = formatStarrailChallengeTitle(title, item.type_name);
      if (!startAt || !endAt || endAt <= startAt || !title) {
        skipped++;
        issues.push({ id: `${game}:${key}:missing:${String(item.id ?? item.banner_type ?? index)}`, game,
          title: title || `${key} · ${index + 1}번째 항목`, reason: '시작·종료 기간 또는 제목 확인 필요. 캘린더에서 제외된 항목입니다.', sourceUrl,
          excerpt: stripHtml(typeof item.description === 'string' ? item.description : '').slice(0, 6000) });
        continue;
      }
      const isHardChallenge = isGenshinHardChallenge(item.type_name, title);
      const icons = kind === 'banner' ? ['characters', 'weapons', 'light_cones', 'agents', 'w_engines'].flatMap((field) => {
        const entities = item[field];
        return Array.isArray(entities) ? entities.filter(isRecord)
          .filter((entity) => entity.rarity === 5 || entity.rarity === '5' || entity.rarity === 'S').map((entity) => entity.icon) : [];
      }) : [];
      const imageUrls = [...new Set([item.image_url, ...icons].filter(isImageUrl))].slice(0, 12);
      const entities = ['characters', 'weapons', 'light_cones', 'agents', 'w_engines'].flatMap((field) => {
        const values = item[field];
        return Array.isArray(values) ? values.filter(isRecord).map((entity) => `${field}:${String(entity.id ?? entity.name ?? '')}`).sort() : [];
      });
      const fallbackId = createHash('sha256').update(typeof item.localization_key === 'string' ? item.localization_key
        : JSON.stringify([item.banner_type, item.type_name, entities.length ? entities : title])).digest('hex').slice(0, 24);
      const hasId = typeof item.id === 'number' || typeof item.id === 'string';
      const sourceId = !hasId ? fallbackId : kind === 'challenge' && item.id === 0 ? `${String(item.id)}:${String(item.type_name ?? '')}` : String(item.id);
      events.push({ id: `${game}:${kind}:${sourceId}:${startAt}`,
        collectionMethod: 'structured', game, kind: isHardChallenge ? 'challenge' : kind, title, startAt, endAt, sourceUrl,
        description: typeof item.description === 'string' ? stripHtml(item.description) : '', sourceLanguage,
        ...(imageUrls.length ? { imageUrls } : {}),
        ...(typeof item.localization_key === 'string' && item.localization_key.startsWith(`hoyo:${game}:`) && item.localization_key.length <= 500 ? { localizationKey: item.localization_key } : {}),
        ...(sourceLanguage === 'en-us' && item.localized === true ? { displayLanguage: 'ko-kr' } : {}) });
      if (sourceLanguage === 'en-us' && item.localized !== true) issues.push({ id: `translation:${game}:${key}:${String(item.id ?? index)}`,
        game, title, reason: '한국어 이름 미수집. 원문 ID를 확인하고 일정 제목을 보정하세요.', sourceUrl,
        excerpt: `원문 제목: ${String(item.original_name ?? '')}`, eventId: events.at(-1)?.id });
    }
  }
  return { events, skipped, issues };
};

export const parseHoyoVersions = (data: unknown): VersionBoundary[] => {
  if (!Array.isArray(data)) throw new Error('Unexpected news schema');
  const result: VersionBoundary[] = [];
  for (const item of data) {
    if (!isRecord(item) || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.url !== 'string') continue;
    if (!/버전.*(?:업데이트 안내|업데이트 공지|업데이트 설명|업데이트 상세|업데이트 및 보상)/.test(item.title) || /오류|발견/.test(item.title)) continue;
    const version = /(\d+\.\d+)\s*버전/.exec(item.title)?.[1];
    const text = stripHtml(item.description);
    const section = /업데이트 (?:시작 )?시간[\s\S]{0,200}/.exec(text)?.[0];
    if (!version || !section) continue;
    const offsetHours = /한국 시간|KST|UTC\+9/.test(section) ? 9 : /UTC\+8/.test(section) ? 8 : null;
    if (offsetHours === null) continue;
    const date = new RegExp(DATE_PATTERN).exec(section)?.[0];
    const maintenanceStart = date ? parseLocalDate(date, offsetHours) : null;
    const hours = /(?:예상 소요 시간(?:은|[:：])?|약|예상)\s*(\d+)\s*시간/.exec(section)?.[1];
    if (!maintenanceStart || !hours) continue;
    const endAt = parseVersionEnd(text, version, offsetHours);
    result.push({ version, maintenanceStart, startAt: new Date(Date.parse(maintenanceStart) + Number(hours) * 3600000).toISOString(), sourceUrl: item.url, ...(endAt ? { endAt } : {}) });
  }
  const unique = new Map<string, VersionBoundary>();
  for (const boundary of result) {
    const previous = unique.get(boundary.version);
    unique.set(boundary.version, previous?.endAt && !boundary.endAt ? previous : boundary);
  }
  return [...unique.values()];
};
