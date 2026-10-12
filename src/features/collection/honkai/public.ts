import { createHash } from 'node:crypto';
import { isImageUrl, isRecord, type CalendarEvent, type TimeEvidence } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { fetchHtml } from '../http';
import { parseLocalDate } from '../parsers';
import type { HonkaiArticle } from './parsers';

export const HONKAI_TIMELINE_BASE = 'https://www.arustats.com/en-us/hi3/timeline/';
const key = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const ALIASES: [string, string][] = [
  ['Fenghuang of Vicissitude', '부생·도진의 날개'], ['Jovial Deception', '기만·여명의 그림자'],
  ['Senadina', '세나디아'], ['Mad Pleasure', '향락·광란의 연회'], ['Lone Destruction', '파기·등불의 그림자'],
  ['Planar Armament', '차원 무장·카오스'], ['PAWS', '차원 무장·카오스'],
  ['Cabbage Farm', '별들의 텃밭'], ['Star-Tempering Clash', '별들의 격투'],
  ['Topop Event', '별의 소망'], ['Topup Event', '별의 소망'],
  ['P2 Finale', '이제, 미래를 품어라'], ["Captain's Wishing Tree Secrets", '비화: 함장과 소원 나무'],
  ['Flying to Oxia invitation Contest', '날아라, 옥시아를 향해!'], ['8-Day Login: 5 Equip Cards', '서광의 희망'],
  ['Crane of Taixuan', '태허의 학'],
];

export const parseHonkaiTimelinePage = (html: string): unknown => {
  const payload = /<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!payload || payload.length > 2000000) throw new Error('Honkai timeline data unavailable');
  const raw: unknown = JSON.parse(payload);
  if (!isRecord(raw) || !isRecord(raw.props) || !isRecord(raw.props.pageProps)) throw new Error('Unexpected Honkai timeline page');
  return raw.props.pageProps.timeline;
};

const dateBoundary = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const date = /^(\d{4})-(\d{1,2})-(\d{1,2}) 0:0:0$/.exec(value);
  return date ? parseLocalDate(`${date[1]}/${date[2]}/${date[3]} 00:00`, 9) : null;
};

const nearestDate = (month: string, date: string, time: string, anchor: string) => {
  const year = new Date(Date.parse(anchor) + 9 * 3600000).getUTCFullYear();
  return [year - 1, year, year + 1].flatMap((candidate) => {
    const at = parseLocalDate(`${candidate}/${month}/${date} ${time}`, 9);
    return at ? [at] : [];
  }).sort((a, b) => Math.abs(Date.parse(a) - Date.parse(anchor)) - Math.abs(Date.parse(b) - Date.parse(anchor)))[0];
};

const matchesCategory = (text: string, category: string) => category === 'event' ? /이벤트|로그인/.test(text)
  : /장비/.test(category) ? /장비|무장|테마 보급/.test(text)
    : /랭크업/.test(category) ? /랭크업 보급/.test(text)
      : /협력/.test(category) ? /협력 보급/.test(text)
        : /코스튬/.test(category) ? /코스튬|복각/.test(text) : /캐릭터 보급/.test(text);

const learnLabels = (articles: HonkaiArticle[], versionNumber: string) => {
  const corpus = key(articles.map((article) => `${article.title}\n${article.description}`).join('\n'));
  const labels = new Map(ALIASES.filter(([, korean]) => corpus.includes(key(korean))).map(([english, korean]) => [key(english), korean]));
  for (const article of articles) {
    if (!article.englishDescription) continue;
    const korean = article.description.split('\n').filter((line) => line.startsWith('★'));
    const english = article.englishDescription.split('\n').filter((line) => line.startsWith('★'));
    if (korean.length !== english.length) continue;
    for (const [index, line] of korean.entries()) {
      const name = /「([^」]+)」/.exec(line)?.[1];
      const original = /:\s*(.+)$/.exec(english[index]!)?.[1];
      if (name && original && !/Equipment|装備/.test(english[index]!)) labels.set(key(original), name);
    }
  }
  if (versionNumber === '9.0' && corpus.includes(key('승휘의 별'))) labels.set(key('7-Day Login:120 crystal, 1 FoV DLC stigma box and more materials'), '승휘의 별');
  if (versionNumber === '9.0' && corpus.includes(key('꿈의 틈새로 비친 빛'))) labels.set(key('7-Day Login:300 crystals (cont from v8.9)'), '꿈의 틈새로 비친 빛');
  return labels;
};

const officialOpening = (articles: HonkaiArticle[], name: string, fallback: string, version: CalendarEvent, category: string, continuation: boolean) => {
  const matches: { at: string; sourceUrl: string }[] = [];
  for (const article of articles) {
    for (const line of article.description.split('\n')) {
      if (!line.includes('|') || !key(line).includes(key(name))) continue;
      const heading = line.split('|')[0]!;
      if (category === 'event' && key(heading) !== key(name)) continue;
      if (category !== 'event' && !(/장비/.test(category) ? /장비|무장|테마 보급/.test(heading)
        : /랭크업/.test(category) ? /랭크업 보급/.test(heading)
          : /협력/.test(category) ? /협력 보급/.test(heading)
            : /코스튬/.test(category) ? /코스튬|복각/.test(line) : /캐릭터 보급/.test(heading))) continue;
      const date = /\|\s*(\d+)월\s*(\d+)일/.exec(line);
      if (!date) continue;
      const at = nearestDate(date[1]!, date[2]!, '00:00', fallback);
      if (at && Date.parse(at) >= Date.parse(version.startAt) - (continuation ? 14 : 1) * 86400000 && at < version.endAt
        && Math.abs(Date.parse(at) - Date.parse(fallback)) <= 14 * 86400000) matches.push({ at, sourceUrl: article.url });
    }
  }
  const unique = [...new Map(matches.map((match) => [match.at, match])).values()];
  return unique.length === 1 ? unique[0] : undefined;
};

const officialPeriod = (articles: HonkaiArticle[], name: string, version: CalendarEvent, category: string) => {
  const number = /(\d+\.\d+)/.exec(version.title)?.[1];
  const matches: { startAt: string; endAt: string; sourceUrl: string }[] = [];
  for (const article of articles.filter((item) => key(item.title).includes(key(name)))) {
    const lines = article.description.split('\n');
    for (const [index, line] of lines.entries()) {
      const context = /보급|로그인|이벤트/.test(line) ? line : `${lines[index - 1] ?? ''}\n${line}`;
      if (!matchesCategory(context, category) || category === 'event' && !key(context).includes(key(name))) continue;
      for (const range of line.matchAll(/(\d+\.\d+)\s*버전 업데이트 후\s*[~～–-]\s*(\d+)월\s*(\d+)일\s*(\d{1,2}:\d{2}(?::\d{2})?)/g)) {
        if (range[1] !== number) continue;
        const endAt = nearestDate(range[2]!, range[3]!, range[4]!, version.startAt);
        if (endAt && Date.parse(endAt) > Date.parse(version.startAt) && Date.parse(endAt) < Date.parse(version.endAt) + 86400000) {
          matches.push({ startAt: version.startAt, endAt, sourceUrl: article.url });
        }
      }
    }
  }
  const unique = [...new Map(matches.map((match) => [match.endAt, match])).values()];
  return unique.length === 1 ? unique[0] : undefined;
};

export const parseHonkaiPublicTimeline = (raw: unknown, version: CalendarEvent, articles: HonkaiArticle[], sourceUrl: string) => {
  if (!isRecord(raw) || raw.version !== /(\d+\.\d+)/.exec(version.title)?.[1]
    || !Array.isArray(raw.scheduleDates) || !raw.scheduleDates.length || raw.scheduleDates.length > 16
    || !Array.isArray(raw.scheduleActivities)) throw new Error('Unexpected Honkai timeline schema or version');
  const periods = raw.scheduleDates.map((period) => {
    if (!isRecord(period)) throw new Error('Unexpected Honkai timeline week');
    const start = dateBoundary(period.startDate), end = dateBoundary(period.endDate);
    if (!start || !end || end <= start) throw new Error('Invalid Honkai timeline week dates');
    return { start, end };
  });
  if (periods.some((period, index) => index > 0 && periods[index - 1]!.end !== period.start)
    || Math.abs(Date.parse(periods[0]!.start) - Date.parse(version.startAt)) > 86400000
    || Math.abs(Date.parse(periods.at(-1)!.end) - Date.parse(version.endAt)) > 86400000) {
    throw new Error('Honkai regional timeline does not match Korean version dates');
  }
  const scopedArticles = articles.filter((article) => {
    const namedVersion = /(\d+\.\d+)\s*버전.*(?:업데이트|점검) 공지/.exec(article.title)?.[1];
    return (!namedVersion || namedVersion === raw.version)
      && article.createdAt * 1000 >= Date.parse(version.startAt) - 30 * 86400000
      && article.createdAt * 1000 < Date.parse(version.endAt) + 86400000;
  });
  const labels = learnLabels(scopedArticles, String(raw.version));
  const events: CalendarEvent[] = [];
  const issues: CollectionIssue[] = [];
  let skipped = 0;
  for (const row of raw.scheduleActivities) {
    if (!isRecord(row) || typeof row.row !== 'string' || !Array.isArray(row.content)) throw new Error('Unexpected Honkai timeline row');
    const kind = /SUPPLY|ARMAMENT|OUTFIT|CARNIVAL EQUIPMENT/.test(row.row) ? 'banner' : /^EVENT \d+$/.test(row.row) ? 'event' : undefined;
    if (!kind) {
      skipped += row.content.length;
      if (row.content.length) issues.push({ id: `honkai:timeline:${raw.version}:${row.row}:category`, game: 'honkai', title: row.row,
        reason: '공개 일정의 새 분류 연결 미확인. 자동 포함 보류', sourceUrl, excerpt: '' });
      continue;
    }
    for (const [index, item] of row.content.entries()) {
      if (!isRecord(item) || !Number.isInteger(item.startWeek) || !Number.isInteger(item.endWeek)
        || typeof item.startWeek !== 'number' || typeof item.endWeek !== 'number' || item.startWeek < 1
        || item.endWeek <= item.startWeek || item.endWeek > periods.length + 1 || !isRecord(item.miniature)
        || typeof item.miniature.titleTop !== 'string') {
        skipped++;
        issues.push({ id: `honkai:timeline:${raw.version}:${row.row}:${index}:schema`, game: 'honkai', title: row.row,
          reason: '공개 일정의 주차·항목 형식 확인 필요', sourceUrl, excerpt: '' });
        continue;
      }
      const original = [item.miniature.titleTop, item.miniature.titleMid].filter((value): value is string => typeof value === 'string').join(' ');
      const originalKey = key(original);
      const matched = [...labels].filter(([name]) => originalKey === name || originalKey.startsWith(name))
        .sort((a, b) => b[0].length - a[0].length)[0];
      // 한국 공지에서 확인한 콘텐츠만 연결하여 중국 서버 전용 행사 제외
      if (!matched) {
        skipped++;
        issues.push({ id: `honkai:timeline:${raw.version}:${row.row}:${index}:name`, game: 'honkai', title: original,
          reason: '한국 공지와 콘텐츠 이름 연결 미확인. 자동 포함 보류', sourceUrl, excerpt: original });
        continue;
      }
      const name = matched[1];
      const category = row.row.includes('EQUIPMENT') || row.row.includes('ARMAMENT') ? '장비 보급'
        : row.row.includes('ASTRAL') ? '협력 보급' : row.row.includes('ASCENSION') ? '랭크업 보급'
          : row.row.includes('OUTFIT') ? '코스튬 보급' : '캐릭터 보급';
      const title = kind === 'banner' ? `${name} · ${category}` : name;
      const fallback = periods[item.startWeek - 1]!.start;
      const opening = officialOpening(scopedArticles, name, fallback, version, kind === 'event' ? 'event' : category, /cont from v/i.test(original));
      const verified = officialPeriod(scopedArticles, name, version, kind === 'event' ? 'event' : category);
      const startAt = verified?.startAt ?? opening?.at ?? fallback, endAt = verified?.endAt ?? periods[item.endWeek - 2]!.end;
      if (endAt <= startAt) { skipped++; continue; }
      const titleTop = item.miniature.titleTop;
      const repeated = row.content.filter((candidate) => isRecord(candidate) && isRecord(candidate.miniature)
        && candidate.miniature.titleTop === titleTop).length > 1;
      const hash = createHash('sha256').update(`${row.row}:${key(titleTop)}${repeated ? `:${item.startWeek}` : ''}`).digest('hex').slice(0, 20);
      const preciseStart = verified && version.timeEvidence?.start?.at === version.startAt
        && ['official', 'manual'].includes(version.timeEvidence.start.basis) && version.timeEvidence.start.precision !== 'date';
      const startsWithVersion = verified || item.startWeek === 1 && startAt === fallback && !/cont from v/i.test(original);
      const imageUrls = ['image_right', 'image_left', 'image_center'].flatMap((field) => {
        const path = item.miniature && isRecord(item.miniature) ? item.miniature[field] : undefined;
        if (typeof path !== 'string' || !path.startsWith('/images/')) return [];
        const url = new URL(path, 'https://www.arustats.com').href;
        return isImageUrl(url) ? [url] : [];
      });
      const evidence = (at: string): TimeEvidence => ({ at, basis: 'community-data', precision: 'date', sourceUrl });
      events.push({ id: `honkai:timeline:${raw.version}:${hash}:${fallback}`, identityKey: `honkai:timeline:${raw.version}:${hash}`,
        game: 'honkai', kind, title, startAt, endAt, sourceUrl: verified?.sourceUrl ?? sourceUrl,
        ...(startsWithVersion ? { versionStartId: version.id } : {}),
        sourceLanguage: verified ? 'ko-kr' : 'en-us', displayLanguage: 'ko-kr',
        collectionMethod: 'structured', ...(verified && preciseStart ? {} : { periodBasis: 'community-data' as const }),
        description: verified ? `한국 공식 상세 공지의 버전 업데이트 후~종료 시각 적용. 원본: ${original}`
          : `지역 서버용 공개 예상 일정. 한국 공식 공지에서 콘텐츠 확인${opening ? '·개방일 보정' : ''}. 실제 종료 시각 미확인. 원본: ${original}`,
        timeEvidence: verified ? { start: { at: startAt, basis: 'official', precision: preciseStart ? 'second' : 'date', sourceUrl: verified.sourceUrl },
          end: { at: endAt, basis: 'official', precision: 'minute', sourceUrl: verified.sourceUrl } }
          : { start: opening ? { at: startAt, basis: 'official', precision: 'date', sourceUrl: opening.sourceUrl } : evidence(startAt), end: evidence(endAt) },
        ...(imageUrls.length ? { imageUrls } : {}) });
    }
  }
  return { events, issues, skipped };
};

export const fetchHonkaiPublicTimeline = async (version: CalendarEvent, articles: HonkaiArticle[]) => {
  const number = /(\d+\.\d+)/.exec(version.title)?.[1];
  if (!number) throw new Error('Korean Honkai version unavailable');
  const url = new URL(number, process.env.HONKAI_TIMELINE_BASE ?? HONKAI_TIMELINE_BASE);
  return parseHonkaiPublicTimeline(parseHonkaiTimelinePage(await fetchHtml(url)), version, articles, url.href);
};
