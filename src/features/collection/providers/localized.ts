import { isImageUrl, type CalendarEvent, type EventKind } from '../../../../shared/calendar';
import { parseLocalDate, parseVersionEnd, stripHtml, type VersionBoundary, type WuwaArticle } from './parsers';

const DATE = '\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?';
const normalizeDates = (text: string) => text.replace(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, '$1/$2/$3');
export const WUWA_END_CONTENT = /종말 매트릭스|역경의 탑|죽음의 노래와 바닷속 폐허/;

export const parseWuwaBannerAliases = (article: WuwaArticle) => {
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

export const parseWuwaKoreanBoundary = (article: WuwaArticle): VersionBoundary | null => {
  const version = /(\d+\.\d+)\s*버전.*업데이트/.exec(article.title)?.[1];
  const text = normalizeDates(stripHtml(article.content));
  const range = new RegExp(`점검 시간[:：]?\\s*(${DATE})\\s*[-–~]\\s*(${DATE})`).exec(text);
  const maintenanceStart = range?.[1] ? parseLocalDate(range[1], 9) : null;
  const startAt = range?.[2] ? parseLocalDate(range[2], 9) : null;
  const endAt = version ? parseVersionEnd(text, version, 9) : null;
  return version && maintenanceStart && startAt ? { version, maintenanceStart, startAt, ...(endAt ? { endAt } : {}),
    sourceUrl: article.sourceUrl ?? `https://wutheringwaves.kurogames.com/kr/main/news/detail/${article.id}` } : null;
};

export const parseWuwaKoreanEvents = (article: WuwaArticle, boundaries: VersionBoundary[]) => {
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
      && (/^[✦■●\d.\s]*[\[「].+[\]」].*(?:이벤트|튜닝|콘텐츠)/.test(candidate) || WUWA_END_CONTENT.test(candidate)));
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
    const kind: EventKind = WUWA_END_CONTENT.test(title) ? 'challenge' : /튜닝/.test(title) ? 'banner' : 'event';
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

export const parseEndfieldBoundary = (article: WuwaArticle): VersionBoundary | null => {
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

const endfieldWeaponPeriod = (text: string, version: VersionBoundary | undefined, banners: CalendarEvent[]) => {
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

export const parseEndfieldEvents = (article: WuwaArticle, boundaries: VersionBoundary[], banners: CalendarEvent[] = []) => {
  const lines = stripHtml(article.content).split('\n').map((line) => line.trim()).filter(Boolean);
  const events: CalendarEvent[] = [];
  const unresolvedPeriods: string[] = [];
  const text = lines.join(' ');
  const ownVersion = boundaries.find((boundary) => article.title.includes(boundary.version)
    || text.includes(`「${boundary.version}」버전`) || text.includes(`「${boundary.version}」 버전`));
  let skipped = 0;
  for (const [index, line] of lines.entries()) {
    if (!/(?:이벤트|개방)\s*(?:기간|시간)(?:[:：]|\s*$)/.test(line) || /물자 교환|교환소/.test(line)) continue;
    const heading = lines.slice(0, index).reverse().find((candidate) => candidate.length < 150
      && !/^·|(?:이벤트|헤드헌팅|신청) 설명[:：]/.test(candidate)
      && /「.+」/.test(candidate) && /이벤트|헤드헌팅|신청|개방|출석 체크/.test(candidate)
      && (/^(?:\d+\.\s*|▼\/\/\s*)/.test(candidate)
        || /^「.+」.*(?:이벤트|체크|개방|설명|헤드헌팅(?:#\d+)?|신청(?:#\d+)?)$/.test(candidate)
        || /「[^」]+」.*이벤트.*함께 개방/.test(candidate))) ?? article.title;
    const sectionLines = lines.slice(index, index + 7);
    const nextSection = sectionLines.findIndex((candidate, offset) => offset > 0
      && /Americas|Europe 서버|이벤트 설명|(?:이벤트|개방)\s*(?:기간|시간)(?:[:：]|\s*$)|^\d+\.\s*「/.test(candidate));
    const section = (nextSection >= 0 ? sectionLines.slice(0, nextSection) : sectionLines).join(' ');
    const clean = section.replace(/\(서버 시간\)/g, '');
    const weaponPeriod = /신청/.test(heading) ? endfieldWeaponPeriod(clean, ownVersion, banners) : null;
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
    if (!ranges.length && weaponPeriod) ranges.push({ start: weaponPeriod.startAt, end: weaponPeriod.endAt,
      isUtc: true, endIsUtc: true, endSource: weaponPeriod.sourceUrl });
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
        const kind: EventKind = /헤드헌팅|신청/.test(item) ? 'banner' : 'event';
        const title = weaponPeriod ? `${/「[^」]+」/.exec(item)?.[0] ?? item} 무기고 신청`
          : /함께 개방/.test(item) ? `${/「[^」]+」/.exec(item)?.[0] ?? item} 이벤트`
          : item.replace(/^(?:\d+\.\s*|▼\/\/\s*)/, '').replace(/\s*설명$/, '');
        events.push({ id: `endfield:${article.id}:${index}:${rangeIndex}${headings.length > 1 ? `:${headingIndex}` : ''}`, game: 'endfield', kind, title, startAt, endAt,
        sourceUrl: `https://endfield.gryphline.com/ko-kr/news/${article.id}`,
        description: `${section}${weaponPeriod ? ` · ${weaponPeriod.note}` : ''}${range.endSource ? ` · 종료 경계 자료: ${range.endSource}` : ''}`, sourceLanguage: 'ko-kr',
        ...(!/버전.*(?:업데이트|점검|개발자)/.test(article.title) && isImageUrl(article.imageUrl) ? { imageUrls: [article.imageUrl] } : {}),
        ...(weaponPeriod?.estimated ? { periodBasis: 'community-cycle' }
          : range.endSource.includes('starrailassistant.top') ? { periodBasis: 'community-data' } : {}) });
      }
    }
  }
  return { events, skipped, unresolvedPeriods };
};
