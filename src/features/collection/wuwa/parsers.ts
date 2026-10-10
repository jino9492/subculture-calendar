import type { CalendarEvent, EventKind } from '../../../../shared/calendar';
import { parseLocalDate, parseVersionEnd, stripHtml, DATE_PATTERN, type VersionBoundary, type CollectionArticle } from '../parsers';

export const parseWuwaBoundary = (article: CollectionArticle): VersionBoundary | null => {
  if (!/Version.*Update Maintenance Notice/i.test(article.title)) return null;
  const version = /Version\s+(\d+\.\d+)/i.exec(article.title)?.[1];
  const range = new RegExp(`Maintenance Time[:：]?\\s*(${DATE_PATTERN})\\s*[-–~]\\s*(${DATE_PATTERN})`, 'i').exec(stripHtml(article.content));
  const maintenanceStart = range?.[1] ? parseLocalDate(range[1]) : null;
  const startAt = range?.[2] ? parseLocalDate(range[2]) : null;
  const endAt = version ? parseVersionEnd(stripHtml(article.content), version, 8) : null;
  return version && maintenanceStart && startAt ? { version, maintenanceStart, startAt, ...(endAt ? { endAt } : {}),
    sourceUrl: `https://wutheringwaves.kurogames.com/en/main/news/detail/${article.id}` } : null;
};

export const parseWuwaEvents = (article: CollectionArticle, boundaries: VersionBoundary[]) => {
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
