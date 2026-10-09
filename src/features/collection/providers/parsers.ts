import { isImageUrl, isRecord, type CalendarEvent, type EventKind, type GameId } from '../../../../shared/calendar';
import { createHash } from 'node:crypto';
import type { CollectionIssue } from '../../../../shared/admin';

export const stripHtml = (html: string) => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<\/(?:div|p|h[1-6]|li|tr)>|<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

export const parseLocalDate = (text: string, offsetHours = 8): string | null => {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  if (!year || !month || !day || !hour || !minute) return null;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}+${String(offsetHours).padStart(2, '0')}:00`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const local = new Date(date.getTime() + offsetHours * 3600000);
  if (local.getUTCFullYear() !== Number(year) || local.getUTCMonth() + 1 !== Number(month)
    || local.getUTCDate() !== Number(day) || local.getUTCHours() !== Number(hour)
    || local.getUTCMinutes() !== Number(minute) || local.getUTCSeconds() !== Number(second)) return null;
  return date.toISOString();
};

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
      if (game === 'starrail' && kind === 'challenge') {
        const contentNames: Record<string, string> = { ChallengeTypeBoss: '종말의 환영', ChallengeTypeChasm: '혼돈의 기억',
          ChallengeTypeStory: '허구 이야기', ChallengeTypePeak: '이상 중재' };
        const contentName = typeof item.type_name === 'string' ? contentNames[item.type_name] : undefined;
        if (title && contentName && !title.startsWith(contentName)) title = `${contentName} · ${title}`;
      }
      if (!startAt || !endAt || endAt <= startAt || !title) {
        skipped++;
        issues.push({ id: `${game}:${key}:missing:${String(item.id ?? item.banner_type ?? index)}`, game,
          title: title || `${key} · ${index + 1}번째 항목`, reason: '시작·종료 기간 또는 제목 확인 필요. 캘린더에서 제외된 항목입니다.', sourceUrl,
          excerpt: stripHtml(typeof item.description === 'string' ? item.description : '').slice(0, 6000) });
        continue;
      }
      const isHardChallenge = item.type_name === 'ActTypeHardChallenge' && /연월 나선|현실 속 환상극/.test(title);
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

export interface WuwaArticle { id: string; title: string; content: string; publishedAt?: string; sourceUrl?: string; imageUrl?: string }
export interface VersionBoundary { version: string; maintenanceStart: string; startAt: string; sourceUrl: string; endAt?: string; announcedEndDate?: string; endSourceUrl?: string; imageUrl?: string }
const DATE_PATTERN = '\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?';

export const parseVersionEnd = (text: string, version: string, offsetHours: number): string | null => {
  const escaped = `(?:「|\\[)?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:」|\\])?`;
  const end = new RegExp(`(?:${escaped}\\s*버전 종료 (?:시각|시간)(?:은|[:：])?\\s*|${escaped}\\s*버전 기간(?:은|[:：])\\s*${escaped}\\s*버전 업데이트 후\\s*[-–~]\\s*)(${DATE_PATTERN})\\s*\\((KST|한국 시간|UTC\\+8|UTC\\+9)\\)`).exec(text);
  if (end?.[1]) return parseLocalDate(end[1], end[2] === 'UTC+8' ? 8 : 9);
  const period = new RegExp(`(?:Version\\s+${escaped}\\s+(?:Duration|Period)[:：]?|${escaped}\\s*버전 기간[:：])\\s*(?:Version\\s+${escaped}\\s+update|${escaped}\\s*버전 업데이트 후|${DATE_PATTERN})\\s*[-–~]\\s*(${DATE_PATTERN})`, 'i').exec(text);
  return period?.[1] ? parseLocalDate(period[1], offsetHours) : null;
};

export const parseWuwaBoundary = (article: WuwaArticle): VersionBoundary | null => {
  if (!/Version.*Update Maintenance Notice/i.test(article.title)) return null;
  const version = /Version\s+(\d+\.\d+)/i.exec(article.title)?.[1];
  const range = new RegExp(`Maintenance Time[:：]?\\s*(${DATE_PATTERN})\\s*[-–~]\\s*(${DATE_PATTERN})`, 'i').exec(stripHtml(article.content));
  const maintenanceStart = range?.[1] ? parseLocalDate(range[1]) : null;
  const startAt = range?.[2] ? parseLocalDate(range[2]) : null;
  const endAt = version ? parseVersionEnd(stripHtml(article.content), version, 8) : null;
  return version && maintenanceStart && startAt ? { version, maintenanceStart, startAt, ...(endAt ? { endAt } : {}),
    sourceUrl: `https://wutheringwaves.kurogames.com/en/main/news/detail/${article.id}` } : null;
};

export const parseWuwaEvents = (article: WuwaArticle, boundaries: VersionBoundary[]) => {
  const text = stripHtml(article.content);
  const events: CalendarEvent[] = [];
  let skipped = 0;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    if (!/Duration|Event Time|Event Period/i.test(line)) continue;
    const section = lines.slice(index, index + 4).join(' ');
    const range = new RegExp(`(${DATE_PATTERN})\\s*[-–~]\\s*(${DATE_PATTERN})`).exec(section);
    const relative = new RegExp(`Version\\s+(\\d+\\.\\d+)\\s+update\\s*[-–~]\\s*(${DATE_PATTERN})`, 'i').exec(section);
    const startAt = range?.[1] ? parseLocalDate(range[1]) : boundaries.find((boundary) => boundary.version === relative?.[1])?.startAt;
    const endText = range?.[2] ?? relative?.[2];
    const endAt = endText ? parseLocalDate(endText) : null;
    if (!startAt || !endAt || endAt <= startAt) { skipped++; continue; }
    // 여러 픽업이 묶인 공지에서 각 기간 앞의 제목 탐색
    const heading = lines.slice(0, index).reverse().find((candidate) => /Featured.*Convene|\].*(?:Event|Convene)/i.test(candidate));
    const title = heading ?? article.title;
    const kind: EventKind = /Convene/i.test(title) ? 'banner' : /challenge cycle|recurring challenge/i.test(title) ? 'challenge' : 'event';
    events.push({ id: `wuwa:${article.id}:${index}`, game: 'wuwa', kind, title, startAt, endAt,
      sourceUrl: `https://wutheringwaves.kurogames.com/en/main/news/detail/${article.id}`,
      description: section, sourceLanguage: 'en' });
  }
  if (!events.length && !skipped && /Event|Convene|Challenge/i.test(article.title)) skipped++;
  return { events, skipped };
};

export const buildVersionEvents = (game: GameId, boundaries: VersionBoundary[]): CalendarEvent[] => {
  const sorted = [...boundaries].sort((a, b) => a.startAt.localeCompare(b.startAt));
  return sorted.map((boundary, index) => {
    const next = sorted[index + 1];
    const officialEnd = boundary.endAt ?? next?.maintenanceStart;
    const dateEnd = boundary.announcedEndDate ? parseLocalDate(`${boundary.announcedEndDate} 00:00`, 9) : null;
    const endAt = officialEnd ?? dateEnd ?? new Date(Date.parse(boundary.startAt) + 42 * 86400000).toISOString();
    const endSource = boundary.endAt ? boundary.sourceUrl : next?.sourceUrl ?? boundary.endSourceUrl;
    return { id: `${game}:version:${boundary.version}`, game, kind: 'version',
      title: `버전 ${boundary.version}`, startAt: boundary.startAt, endAt,
      versionEndBasis: boundary.endAt ? 'official' : next ? 'next-maintenance' : dateEnd ? 'announced-date' : 'default-42-days',
      ...(endSource && endSource !== boundary.sourceUrl ? { versionEndSourceUrl: endSource } : {}),
      sourceUrl: boundary.sourceUrl, sourceLanguage: game === 'wuwa' ? 'en' : 'ko-kr',
      ...(isImageUrl(boundary.imageUrl) ? { imageUrls: [boundary.imageUrl] } : {}),
      description: officialEnd ? '공식 점검 공지 기준: 예정 점검 종료부터 명시된 버전 종료 또는 다음 버전 점검 시작까지.'
        : dateEnd ? `다음 버전 개방 공지의 ${boundary.announcedEndDate} 날짜를 종료 경계로 표시합니다. 정확한 점검 시작 시각은 아직 수집하지 못했습니다. 날짜 경계는 한국 시간 00:00이며 실제 종료 시각을 의미하지 않습니다.`
          : '종료 시각을 수집 자료에서 찾지 못해 버전 시작부터 42일을 기본값으로 적용했습니다. 정확한 종료·단축 일정이 확인되면 재수집 시 갱신됩니다.' };
  });
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
