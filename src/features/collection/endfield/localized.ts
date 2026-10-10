import { isImageUrl, type CalendarEvent, type EventKind } from '../../../../shared/calendar';
import { parseLocalDate, parseVersionEnd, stripHtml, type VersionBoundary, type CollectionArticle } from '../parsers';

const DATE = '\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?';

export interface EndfieldNews { id: string; title: string }

export const parseEndfieldNewsList = (html: string): EndfieldNews[] => {
  const result: EndfieldNews[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if ('cid' in value && 'title' in value && typeof value.cid === 'string' && /^\d+$/.test(value.cid) && typeof value.title === 'string') {
      result.push({ id: value.cid, title: value.title });
    }
    Object.values(value).forEach(visit);
  };
  for (const match of html.matchAll(/self\.__next_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)/g)) {
    const push: unknown = JSON.parse(match[1] ?? 'null');
    if (!Array.isArray(push) || typeof push[1] !== 'string') continue;
    for (const row of push[1].split('\n')) {
      const payload = row.replace(/^[\da-f]+:/, '');
      if (payload.startsWith('[') || payload.startsWith('{')) {
        try { const value: unknown = JSON.parse(payload); visit(value); }
        catch { continue; }
      }
    }
  }
  if (!result.length) throw new Error('Unexpected Endfield news schema');
  return [...new Map(result.map((article) => [article.id, article])).values()];
};

export const parseEndfieldBoundary = (article: CollectionArticle): VersionBoundary | null => {
  if (!/버전.*(?:업데이트|점검)/.test(article.title)) return null;
  const version = /「([^」]+)」/.exec(article.title)?.[1];
  const text = stripHtml(article.content);
  const range = new RegExp(`Asia 서버[:：]\\s*(${DATE})\\s*[-–~]\\s*(${DATE})\\s*\\(UTC\\+8\\)`).exec(text);
  const maintenanceStart = range?.[1] ? parseLocalDate(range[1], 8) : null;
  const startAt = range?.[2] ? parseLocalDate(range[2], 8) : null;
  const endAt = version ? parseVersionEnd(text, version, 8) : null;
  return version && maintenanceStart && startAt ? { version, maintenanceStart, startAt, ...(endAt ? { endAt } : {}),
    ...(isImageUrl(article.imageUrl) ? { imageUrl: article.imageUrl } : {}),
    sourceUrl: `https://endfield.gryphline.com/ko-kr/news/${article.id}` } : null;
};

export interface EndfieldEventSupplement {
  startAt: string; endAt: string; estimated: boolean; sourceUrl: string; note: string; title: string;
}
export type EndfieldSupplementResolver = (heading: string, text: string, version: VersionBoundary | undefined) => EndfieldEventSupplement | null;

export const parseEndfieldApiEvents = (article: CollectionArticle, boundaries: VersionBoundary[], resolveSupplement?: EndfieldSupplementResolver) => {
  const lines = stripHtml(article.content).split('\n').map((line) => line.trim()).filter(Boolean);
  const events: CalendarEvent[] = [];
  const unresolvedPeriods: string[] = [];
  const text = lines.join(' ');
  const ownVersion = boundaries.find((boundary) => article.title.includes(boundary.version)
    || text.includes(`「${boundary.version}」버전`) || text.includes(`「${boundary.version}」 버전`));
  let skipped = 0;
  for (const [index, line] of lines.entries()) {
    const contentHeading = lines.slice(0, index).reverse().find((candidate) => /^\d+\.\s*「/.test(candidate));
    const echoSeason = /시즌 업데이트[:：]/.test(line) && Boolean(contentHeading?.includes('「전쟁의 메아리」'));
    if (!echoSeason && (!/(?:이벤트|개방)\s*(?:기간|시간)(?:[:：]|\s*$)/.test(line) || /물자 교환|교환소/.test(line))) continue;
    const seasonHeading = echoSeason ? lines.slice(0, index).reverse().find((candidate) => /^○\s*「[^」]+」/.test(candidate)) : undefined;
    const heading = echoSeason ? `전쟁의 메아리 · ${/「([^」]+)」/.exec(seasonHeading ?? '')?.[1] ?? '시즌'}` : lines.slice(0, index).reverse().find((candidate) => candidate.length < 150
      && !/^·|(?:이벤트|헤드헌팅|신청) 설명[:：]/.test(candidate)
      && /「.+」/.test(candidate) && /이벤트|헤드헌팅|신청|개방|출석 체크/.test(candidate)
      && (/^(?:\d+\.\s*|▼\/\/\s*)/.test(candidate)
        || /^「.+」.*(?:이벤트|체크|개방|설명|헤드헌팅(?:#\d+)?|신청(?:#\d+)?)$/.test(candidate)
        || /「[^」]+」.*이벤트.*함께 개방/.test(candidate))) ?? article.title;
    const sectionLines = lines.slice(index, index + 7);
    const nextSection = sectionLines.findIndex((candidate, offset) => offset > 0
      && /Americas|Europe 서버|이벤트 설명|업데이트 설명|시즌 업데이트[:：]|^○\s*「|(?:이벤트|개방)\s*(?:기간|시간)(?:[:：]|\s*$)|^\d+\.\s*「/.test(candidate));
    const section = (nextSection >= 0 ? sectionLines.slice(0, nextSection) : sectionLines).join(' ');
    const clean = section.replace(/\(서버 시간\)/g, '');
    const supplement = resolveSupplement?.(heading, clean, ownVersion) ?? null;
    const ranges = [...clean.matchAll(new RegExp(`(${DATE})\\s*[-–~]\\s*(${DATE})`, 'g'))].map((range) => ({ start: range[1], end: range[2], isUtc: false, endIsUtc: false, endSource: '' }));
    const relativeStart = new RegExp(`버전 업데이트 후\\s*[-–~]\\s*(${DATE})`).exec(clean);
    if (relativeStart && ownVersion?.startAt) ranges.push({ start: ownVersion.startAt, end: relativeStart[1], isUtc: true, endIsUtc: false, endSource: '' });
    const relativeEnd = new RegExp(`(${DATE}|버전 업데이트 후)\\s*[-–~]\\s*(?:다음 )?버전 업데이트\\s*(?:점검\\s*)?전(?:까지)?`).exec(clean);
    if (relativeEnd?.[1]) {
      const startAt = relativeEnd[1] === '버전 업데이트 후' ? ownVersion?.startAt : parseLocalDate(relativeEnd[1], 8);
      const next = startAt ? [...boundaries].filter((boundary) => boundary.maintenanceStart > startAt)
        .sort((a, b) => a.maintenanceStart.localeCompare(b.maintenanceStart))[0] : undefined;
      const activeVersion = ownVersion ?? (startAt ? [...boundaries].filter((boundary) => boundary.startAt <= startAt
        && boundary.endAt && boundary.endAt > startAt).sort((a, b) => b.startAt.localeCompare(a.startAt))[0] : undefined);
      const end = next?.maintenanceStart ?? activeVersion?.endAt;
      if (startAt && end) ranges.push({ start: startAt, end, isUtc: true, endIsUtc: true,
        endSource: next?.sourceUrl ?? activeVersion?.endSourceUrl ?? activeVersion?.sourceUrl ?? '' });
    }
    if (!ranges.length && ownVersion?.endAt && /「[^」]+」\s*버전 기간/.test(clean)) {
      ranges.push({ start: ownVersion.startAt, end: ownVersion.endAt, isUtc: true, endIsUtc: true,
        endSource: ownVersion.endSourceUrl ?? ownVersion.sourceUrl });
    }
    if (!ranges.length && supplement) ranges.push({ start: supplement.startAt, end: supplement.endAt,
      isUtc: true, endIsUtc: true, endSource: supplement.sourceUrl });
    if (!ranges.length) {
      if (/개방 시간/.test(line) && new RegExp(DATE).test(clean) && !/[~–]/.test(clean) && !/3회/.test(clean)) continue;
      skipped++;
      const reason = /상시|장기 개방/.test(section) ? '상시 개방으로 달력 종료일 없음'
        : /3회.*종료/.test(section) ? '헤드헌팅 3회 종료 조건으로 후속 픽업 일정 확인 필요'
          : /버전 업데이트.*전|버전 기간/.test(section) ? '버전 종료 경계 미수집' : '기간 본문·이미지 확인 필요';
      unresolvedPeriods.push(`${heading}: ${reason}`);
      continue;
    }
    for (const [rangeIndex, range] of ranges.entries()) {
      const startAt = range.isUtc ? range.start : range.start ? parseLocalDate(range.start, 8) : null;
      const endAt = range.endIsUtc ? range.end : range.end ? parseLocalDate(range.end, 8) : null;
      if (!startAt || !endAt || endAt <= startAt) { skipped++; continue; }
      const combinedBanners = [...heading.matchAll(/「[^」]+」\s*재구축\s*(?:헤드헌팅|신청)(?:#\d+)?/g)].map((match) => match[0]);
      const headings = combinedBanners.length > 1 ? combinedBanners : [heading];
      for (const [headingIndex, item] of headings.entries()) {
        const kind: EventKind = echoSeason ? 'challenge' : /헤드헌팅|신청/.test(item) ? 'banner' : 'event';
        const title = supplement ? supplement.title
          : /함께 개방/.test(item) ? `${/「[^」]+」/.exec(item)?.[0] ?? item} 이벤트`
          : item.replace(/^(?:\d+\.\s*|▼\/\/\s*)/, '').replace(/\s*설명$/, '');
        events.push({ id: `endfield:${article.id}:${index}:${rangeIndex}${headings.length > 1 ? `:${headingIndex}` : ''}`, game: 'endfield', kind, title, startAt, endAt,
        sourceUrl: `https://endfield.gryphline.com/ko-kr/news/${article.id}`,
        description: `${section}${supplement ? ` · ${supplement.note}` : ''}${range.endSource ? ` · 종료 경계 자료: ${range.endSource}` : ''}`, sourceLanguage: 'ko-kr',
        ...(!/버전.*(?:업데이트|점검|개발자)/.test(article.title) && isImageUrl(article.imageUrl) ? { imageUrls: [article.imageUrl] } : {}),
        ...(supplement?.estimated ? { periodBasis: 'community-cycle' }
          : range.endSource.includes('starrailassistant.top') ? { periodBasis: 'community-data' } : {}) });
      }
    }
  }
  return { events, skipped, unresolvedPeriods };
};
