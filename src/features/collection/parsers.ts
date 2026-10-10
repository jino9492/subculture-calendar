import { isImageUrl, type CalendarEvent, type GameId } from '../../../shared/calendar';

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

export interface CollectionArticle { id: string; title: string; content: string; publishedAt?: string; sourceUrl?: string; imageUrl?: string }

export interface VersionBoundary { version: string; maintenanceStart: string; startAt: string; sourceUrl: string; endAt?: string; announcedEndDate?: string; endSourceUrl?: string; imageUrl?: string }

export const DATE_PATTERN = '\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?';

export const parseVersionEnd = (text: string, version: string, offsetHours: number): string | null => {
  const escaped = `(?:「|\\[)?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:」|\\])?`;
  const end = new RegExp(`(?:${escaped}\\s*버전 종료 (?:시각|시간)(?:은|[:：])?\\s*|${escaped}\\s*버전 기간(?:은|[:：])\\s*${escaped}\\s*버전 업데이트 후\\s*[-–~]\\s*)(${DATE_PATTERN})\\s*\\((KST|한국 시간|UTC\\+8|UTC\\+9)\\)`).exec(text);
  if (end?.[1]) return parseLocalDate(end[1], end[2] === 'UTC+8' ? 8 : 9);
  const period = new RegExp(`(?:Version\\s+${escaped}\\s+(?:Duration|Period)[:：]?|${escaped}\\s*버전 기간[:：])\\s*(?:Version\\s+${escaped}\\s+update|${escaped}\\s*버전 업데이트 후|${DATE_PATTERN})\\s*[-–~]\\s*(${DATE_PATTERN})`, 'i').exec(text);
  return period?.[1] ? parseLocalDate(period[1], offsetHours) : null;
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
