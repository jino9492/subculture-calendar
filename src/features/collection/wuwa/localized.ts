import type { CalendarEvent, EventKind } from '../../../../shared/calendar';
import { parseLocalDate, parseVersionEnd, stripHtml, type VersionBoundary, type CollectionArticle } from '../parsers';

const DATE = '\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?';

const normalizeDates = (text: string) => text.replace(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, '$1/$2/$3');

export const WUWA_END_CONTENT = /종말 매트릭스|역경의 탑|죽음의 노래와 바닷속 폐허/;

export const WUWA_WEEKLY_CONTENT = /수많은 문의 환상|환상의 놀이공원/;

export const parseWuwaBannerAliases = (article: CollectionArticle) => {
  const lines = [article.title, ...stripHtml(article.content).split('\n')].map((line) => line.trim()).filter(Boolean);
  const headers = lines.flatMap((line, index) => /^[\[「][^\]」]+[\]」]\s*(?:캐릭터|무기) 이벤트 튜닝/.test(line) ? [index] : []);
  return headers.flatMap((index, position) => {
    const title = lines[index] ?? '';
    const kind = /캐릭터/.test(title) ? '캐릭터' : '무기';
    const body = lines.slice(index + 1, headers[position + 1] ?? lines.length).join(' ');
    const targets = [...body.matchAll(/5성\s*(캐릭터|공명자|무기)\s*「([^」]+)」/g)]
      .filter((match) => kind === '무기' ? match[1] === '무기' : match[1] !== '무기');
    const names = [...new Set(targets.map((match) => match[2]).filter(Boolean))];
    return names.length === 1 ? [{ title: title.replace(/(?:——|—|확률 UP)[\s\S]*$/, '').trim(), targetTitle: `「${names[0]}」 ${kind} 이벤트 튜닝` }] : [];
  });
};

export const parseWuwaKoreanBoundary = (article: CollectionArticle): VersionBoundary | null => {
  const version = /(\d+\.\d+)\s*버전.*업데이트/.exec(article.title)?.[1];
  const text = normalizeDates(stripHtml(article.content));
  const range = new RegExp(`점검 시간[:：]?\\s*(${DATE})\\s*[-–~]\\s*(${DATE})`).exec(text);
  const maintenanceStart = range?.[1] ? parseLocalDate(range[1], 9) : null;
  const startAt = range?.[2] ? parseLocalDate(range[2], 9) : null;
  const endAt = version ? parseVersionEnd(text, version, 9) : null;
  return version && maintenanceStart && startAt ? { version, maintenanceStart, startAt, ...(endAt ? { endAt } : {}),
    sourceUrl: article.sourceUrl ?? `https://wutheringwaves.kurogames.com/kr/main/news/detail/${article.id}` } : null;
};

export const parseWuwaKoreanEvents = (article: CollectionArticle, boundaries: VersionBoundary[]) => {
  const lines = normalizeDates(stripHtml(article.content)).split('\n').map((line) => line.trim()).filter(Boolean);
  const events: CalendarEvent[] = [];
  const completeBannerPeriods: string[] = [];
  let skipped = 0;
  for (const [index, line] of lines.entries()) {
    if (!/^[✦■●·\s]*(?:이벤트|튜닝|도전|시즌)\s*(?:기간|시간)(?:\s*[:：]|\s*[✦■●]*$)/.test(line)) continue;
    const section = lines.slice(index, index + 3).join(' ');
    const range = new RegExp(`(${DATE})\\s*[-–~]\\s*(${DATE})`).exec(section);
    const relative = new RegExp(`(\\d+\\.\\d+)\\s*버전\\s*업데이트\\s*(?:이후|후)\\s*[-–~]\\s*(${DATE})`).exec(section);
    const startAt = range?.[1] ? parseLocalDate(range[1], 9) : boundaries.find((boundary) => boundary.version === relative?.[1])?.startAt;
    const end = range?.[2] ?? relative?.[2];
    const endAt = end ? parseLocalDate(end, 9) : null;
    if (!startAt || !endAt || endAt <= startAt) { skipped++; continue; }
    const heading = lines.slice(0, index).reverse().find((candidate) => candidate.length < 140
      && (/^[✦■●\d.\s]*[\[「].+[\]」].*(?:이벤트|튜닝|콘텐츠)/.test(candidate) || WUWA_END_CONTENT.test(candidate) || WUWA_WEEKLY_CONTENT.test(candidate)));
    const title = heading ?? article.title;
    const overview = [...title.matchAll(/((?:「[^」]+」[、,\s]*)+)(캐릭터|무기) 이벤트 튜닝/g)];
    if (overview.length === 2 && overview.some((group) => group[2] === '캐릭터') && overview.some((group) => group[2] === '무기')) {
      for (const group of overview) for (const [nameIndex, name] of [...(group[1] ?? '').matchAll(/「([^」]+)」/g)].entries()) {
        events.push({ id: `wuwa:kr:${article.id}:${index}:${group[2]}:${nameIndex}`, game: 'wuwa', kind: 'banner',
          title: `[${name[1]}] ${group[2]} 이벤트 튜닝`, startAt, endAt,
          sourceUrl: article.sourceUrl ?? `https://wutheringwaves.kurogames.com/kr/main/news/detail/${article.id}`, description: section, sourceLanguage: 'ko-kr' });
      }
      completeBannerPeriods.push(`${startAt}:${endAt}`);
      continue;
    }
    const kind: EventKind = WUWA_WEEKLY_CONTENT.test(title) ? 'weekly' : WUWA_END_CONTENT.test(title) ? 'challenge' : /튜닝/.test(title) ? 'banner' : 'event';
    events.push({ id: `wuwa:kr:${article.id}:${index}`, game: 'wuwa', kind, title, startAt, endAt,
      sourceUrl: article.sourceUrl ?? `https://wutheringwaves.kurogames.com/kr/main/news/detail/${article.id}`, description: section, sourceLanguage: 'ko-kr' });
  }
  if (!events.length && !skipped && (/이벤트|튜닝/.test(article.title) || WUWA_END_CONTENT.test(article.title))) skipped++;
  return { events, skipped, completeBannerPeriods };
};

export const selectWuwaEnglishBanners = (korean: CalendarEvent[], english: CalendarEvent[], publications: Record<string, string>) => {
  const key = (event: CalendarEvent) => {
    const type = /캐릭터|Resonator/i.test(event.title) ? 'character' : /무기|Weapon/i.test(event.title) ? 'weapon' : null;
    return event.kind === 'banner' && type && publications[event.id]
      ? `${publications[event.id]}:${type}:${event.startAt}:${event.endAt}` : null;
  };
  const counts = (events: CalendarEvent[]) => {
    const result = new Map<string, number>();
    for (const event of events) { const identity = key(event); if (identity) result.set(identity, (result.get(identity) ?? 0) + 1); }
    return result;
  };
  const koreanCounts = counts(korean);
  const englishCounts = counts(english);
  // 같은 게시 시각·픽업 종류·기간으로 유일하게 대응할 때만 한국어 공지로 대체
  return english.filter((event) => {
    const identity = key(event);
    return event.kind === 'banner' && (!identity || koreanCounts.get(identity) !== 1 || englishCounts.get(identity) !== 1);
  });
};
