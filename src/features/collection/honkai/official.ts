import { createHash } from 'node:crypto';
import type { CalendarEvent, EventKind, TimeEvidence } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { parseLocalDate, stripHtml } from '../parsers';
import { isHonkaiScheduleArticle, type HonkaiArticle } from './parsers';

const key = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const DAY = 86400000;
const quoted = (text: string) => /「([^」]+)」/.exec(text)?.[1];
const category = (text: string) => /협력/.test(text) ? '협력 보급'
  : /랭크업/.test(text) ? '랭크업 보급' : /장비 보급(?!\s*카드)|무장|추천 조합|추천 장비/.test(text) ? '장비 보급'
    : /코스튬/.test(text) ? '코스튬 보급' : '캐릭터 보급';
const canonical = (title: string, kind: EventKind) => {
  const name = quoted(title) ?? title.replace(/^[★☆■【\s]+|[★☆】\s]+$/g, '').trim();
  return kind === 'banner' && !/보급$/.test(name) ? `${name} · ${category(title)}` : name;
};
const dateNear = (month: string, day: string, time: string, anchor: number) => {
  const year = new Date(anchor + 9 * 3600000).getUTCFullYear();
  return [year - 1, year, year + 1].flatMap((year) => {
    const at = parseLocalDate(`${year}/${month}/${day} ${time}`, 9);
    return at ? [at] : [];
  }).sort((a, b) => Math.abs(Date.parse(a) - anchor) - Math.abs(Date.parse(b) - anchor))[0];
};

export interface HonkaiOfficialItem {
  id: string;
  title: string;
  kind: EventKind;
  version?: string;
  opening?: TimeEvidence;
  openingPublishedAt?: number;
  periods: CalendarEvent[];
  references: { article: HonkaiArticle; excerpt: string }[];
}

export const collectHonkaiOfficialItems = (articles: HonkaiArticle[], parsedEvents: CalendarEvent[]) => {
  const versions = parsedEvents.filter((event) => event.kind === 'version');
  const items = new Map<string, HonkaiOfficialItem>();
  const versionFor = (article: HonkaiArticle) => {
    const named = /(\d+\.\d+)\s*버전/.exec(article.title)?.[1];
    const numbers = [...new Set([...article.description.matchAll(/(\d+\.\d+)\s*버전/g)].map((match) => match[1]!))];
    if (named || numbers.length === 1) return named ?? numbers[0];
    return versions.filter((version) => Date.parse(version.startAt) <= article.createdAt * 1000 + 14 * DAY
      && Date.parse(version.endAt) >= article.createdAt * 1000)
      .sort((a, b) => Math.abs(Date.parse(a.startAt) - article.createdAt * 1000)
        - Math.abs(Date.parse(b.startAt) - article.createdAt * 1000))
      .map((version) => /(\d+\.\d+)/.exec(version.title)?.[1])[0];
  };
  const add = (article: HonkaiArticle, title: string, kind: EventKind, excerpt: string,
    opening?: TimeEvidence, period?: CalendarEvent) => {
    title = canonical(title, kind);
    if (!title || kind === 'version') return;
    const version = versionFor(article);
    const group = `${version ?? 'unknown'}:${kind}:${key(title)}`;
    let item = items.get(group);
    if (!item) {
      const hash = createHash('sha256').update(`${kind}:${key(title)}`).digest('hex').slice(0, 20);
      item = { id: `honkai:official:${article.id}:${hash}`, title, kind, version, periods: [], references: [] };
      items.set(group, item);
    }
    if (!item.references.some((reference) => reference.article.id === article.id && reference.excerpt === excerpt)) {
      item.references.push({ article, excerpt });
    }
    if (opening && (!item.opening || article.createdAt >= (item.openingPublishedAt ?? 0))) {
      item.opening = opening;
      item.openingPublishedAt = article.createdAt;
    }
    if (period) item.periods.push({ ...period, title });
  };
  for (const article of [...articles].filter(isHonkaiScheduleArticle)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const lines = stripHtml(article.description).split('\n').map((line) => line.trim()).filter(Boolean);
    if (quoted(article.title) && /이벤트|도전|보급/.test(article.title) && !/버전.*업데이트 공지/.test(article.title)) {
      add(article, article.title, /보급/.test(article.title) ? 'banner' : /도전/.test(article.title) ? 'challenge' : 'event', article.title);
    }
    let heading: string | undefined;
    for (const line of lines) {
      if (/^[★☆■【◆]/.test(line)) {
        heading = quoted(line) && /이벤트|로그인|스토리|보너스|상점|추첨|보급|도전/.test(line)
          || /누적\s*(?:소모|충전)|타임캡슐/.test(line) ? line : undefined;
        if (heading) add(article, heading, /보급/.test(heading) ? 'banner' : 'event', line);
      }
      const opening = /^(\d+)월\s*(\d+)일.*?「([^」]+)」.*(?:이벤트 개방|업데이트|개방)/.exec(line);
      if (opening) {
        const at = dateNear(opening[1]!, opening[2]!, '00:00', article.createdAt * 1000);
        add(article, opening[3]!, 'event', line,
          at ? { at, basis: 'official', precision: 'date', sourceUrl: article.url } : undefined);
      }
      const weekly = /^(.{2,100}?)\s*\|\s*(.+)$/.exec(line);
      if (weekly && /이벤트|보급|로그인|BP|복귀|코스튬|재입하/.test(line)) {
        const kind = /보급/.test(weekly[1]!) ? 'banner' : 'event';
        const title = kind === 'banner' && quoted(weekly[2]!) ? `${quoted(weekly[2]!)} · ${category(weekly[1]!)}` : weekly[1]!;
        const date = /^(\d+)월\s*(\d+)일/.exec(weekly[2]!.trim());
        const at = date && dateNear(date[1]!, date[2]!, '00:00', article.createdAt * 1000);
        add(article, title, kind, line, at ? { at, basis: 'official', precision: 'date', sourceUrl: article.url } : undefined);
      }
      if (/UTC\+8|서버 시간|수령 기간|보상 내용/.test(line)) continue;
      const ranges = [...line.matchAll(/(?:(\d+)월\s*(\d+)일\s*(\d{1,2}:\d{2}(?::\d{2})?)|(\d+\.\d+)\s*버전 업데이트 후)\s*[~～–-]\s*(\d+)월\s*(\d+)일\s*(\d{1,2}:\d{2}(?::\d{2})?)/g)];
      for (const [index, range] of ranges.entries()) {
        // 각 기간 뒤의 설명만 연결하여 같은 줄의 다음 회차와 보상 설명 혼입 방지
        const clause = line.slice(range.index! + range[0].length, ranges[index + 1]?.index);
        const context = `${/^\[[^\]]+\]/.exec(line)?.[0] ?? ''} ${clause}`;
        const kind = /보급/.test(context + (heading ?? '')) ? 'banner' : /도전/.test(line) ? 'challenge' : 'event';
        // 본문의 인용구는 이벤트로 명시된 이름만 사용하여 보상명 승격 방지
        const namedEvent = /「([^」]+)」\s*(?:이벤트|도전|스토리)/.exec(line)?.[1]
          ?? /(?:이벤트|도전|스토리)\s*「([^」]+)」/.exec(line)?.[1];
        const subject = kind === 'banner' ? quoted(clause) ?? quoted(article.title) ?? heading
          : heading ?? namedEvent ?? (/이벤트|도전/.test(article.title) ? quoted(article.title) : undefined);
        if (!subject) continue;
        const version = versions.find((event) => event.id === `honkai:version:${range[4] ?? versionFor(article)}`);
        const startAt = range[1] ? dateNear(range[1], range[2]!, range[3]!, article.createdAt * 1000) : version?.startAt;
        const endAt = startAt && dateNear(range[5]!, range[6]!, range[7]!, Date.parse(startAt));
        if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) continue;
        const categories = /캐릭터 보급/.test(context) && /장비 보급(?!\s*카드)/.test(context) && !/협력|랭크업/.test(context)
          ? ['캐릭터 보급', '장비 보급'] : [category(context + (heading ?? ''))];
        const evidence = (at: string, time: string): TimeEvidence => ({ at, basis: 'official',
          precision: time.split(':').length === 3 ? 'second' : 'minute', sourceUrl: article.url });
        for (const supply of kind === 'banner' ? categories : ['']) {
          const title = kind === 'banner' ? `${quoted(subject) ?? subject} · ${supply}` : subject;
          add(article, title, kind, line, undefined, { id: `honkai:detail:${article.id}:${key(title)}:${startAt}`, title,
            game: 'honkai', kind, startAt, endAt, sourceUrl: article.url, sourceLanguage: 'ko-kr', description: line,
            collectionMethod: 'announcement', ...(version ? { versionStartId: version.id } : {}),
            timeEvidence: { start: range[1] ? evidence(startAt, range[3]!) : version?.timeEvidence?.start,
              end: evidence(endAt, range[7]!) } });
        }
      }
    }
    for (const event of parsedEvents.filter((event) => event.kind !== 'version' && event.sourceUrl === article.url)) {
      add(article, event.title, event.kind, event.description, undefined, event);
    }
  }
  return [...items.values()];
};

export const resolveHonkaiOfficialItems = (items: HonkaiOfficialItem[], supplements: CalendarEvent[]) => {
  const events: CalendarEvent[] = [], issues: CollectionIssue[] = [];
  for (const item of items) {
    const reference = item.references[0]!;
    const periods = [...new Map(item.periods.map((event) => [`${event.startAt}:${event.endAt}`, event])).values()];
    const external = supplements.filter((event) => event.crossChecked && event.kind === item.kind && key(event.title) === key(item.title)
      && (!item.version || event.id.startsWith(`honkai:timeline:${item.version}:`))
      && (!item.opening || Math.abs(Date.parse(item.opening.at) - Date.parse(event.startAt)) <= 14 * DAY));
    // 공식 기간을 우선하고 서로 다른 회차·충돌 기간은 자동 연결에서 제외
    const candidates = periods.length ? periods : external;
    const period = candidates.length === 1 ? candidates[0] : undefined;
    if (!period) {
      issues.push({ id: `${item.id}:period`, game: 'honkai', title: item.title, sourceUrl: reference.article.url,
        reason: candidates.length > 1 ? '공식 목록 수집 완료 · 기간 또는 회차 대조 충돌. 상세 공지 확인 필요'
          : '공식 목록 수집 완료 · 시작·종료 기간 미확정. 상세 공지 수집 후 자동 보완',
        excerpt: [item.opening ? `공식 개방일: ${item.opening.at}` : '개방 시각 미확인',
          ...item.references.map((reference) => `${reference.article.url}\n${reference.excerpt}`)].join('\n').slice(0, 6000) });
      continue;
    }
    const opening = periods.length ? period.timeEvidence?.start : item.opening ?? period.timeEvidence?.start;
    const startAt = opening?.at ?? period.startAt;
    if (Date.parse(period.endAt) <= Date.parse(startAt)) {
      issues.push({ id: `${item.id}:period`, game: 'honkai', title: item.title, sourceUrl: reference.article.url,
        reason: '공식 개방일과 보완 종료가 역전. 상세 공지 확인 필요', excerpt: `${startAt} ~ ${period.endAt}` });
      continue;
    }
    events.push({ ...period, id: item.id, identityKey: item.id, title: item.title, startAt, sourceUrl: reference.article.url,
      sourceLanguage: 'ko-kr', displayLanguage: 'ko-kr', collectionMethod: 'announcement', crossChecked: true,
      timeEvidence: { ...period.timeEvidence, ...(opening ? { start: opening } : {}) },
      collectionSources: [...new Map([period, ...(period.collectionSources ?? [])].map((event) => [event.id, {
        id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, sourceUrl: event.sourceUrl }])).values()],
      description: `${periods.length ? '공식 한국어 기간' : '공식 목록 기준 · 공개 타임라인 기간 대조'}\n${period.description}` });
  }
  return { events, issues };
};

export const preserveHonkaiReferences = (previous: CalendarEvent[], next: CalendarEvent[]) => next.map((event) => {
  if (event.game !== 'honkai' || event.kind === 'version') return event;
  const matches = previous.filter((candidate) => candidate.game === event.game && candidate.kind === event.kind
    && key(candidate.title) === key(event.title)
    && Math.abs(Date.parse(candidate.startAt) - Date.parse(event.startAt)) <= DAY
    && Math.abs(Date.parse(candidate.endAt) - Date.parse(event.endAt)) <= DAY
    && Math.max(Date.parse(candidate.startAt), Date.parse(event.startAt)) < Math.min(Date.parse(candidate.endAt), Date.parse(event.endAt)));
  if (matches.length !== 1) return event;
  const previousEvent = matches[0]!;
  if (next.filter((candidate) => candidate.game === event.game && candidate.kind === event.kind
    && key(candidate.title) === key(event.title) && Math.abs(Date.parse(candidate.startAt) - Date.parse(previousEvent.startAt)) <= DAY).length !== 1) return event;
  // 회차가 유일하게 일치한 이전 ID만 별칭으로 보존하여 완료·보정 기록 승계
  return { ...event, collectionSources: [...new Map([...(event.collectionSources ?? []), previousEvent,
    ...(previousEvent.collectionSources ?? [])].map((source) => [source.id, { id: source.id, title: source.title,
      startAt: source.startAt, endAt: source.endAt, sourceUrl: source.sourceUrl }])).values()].slice(0, 100) };
});

export const mergeHonkaiScheduleSources = (official: ReturnType<typeof resolveHonkaiOfficialItems>,
  supplements: CalendarEvent[], inventory: HonkaiOfficialItem[]) => {
  const events = [...official.events];
  const officialIds = new Set(official.events.map((event) => event.id));
  const versionOf = (event: CalendarEvent) => inventory.find((item) => item.id === event.id)?.version
    ?? /^honkai:timeline:(\d+\.\d+):/.exec(event.id)?.[1]
    ?? /honkai:version:(\d+\.\d+)/.exec(event.versionStartId ?? '')?.[1];
  for (const supplement of supplements) {
    const linked = events.find((event) => event.id === supplement.id
      || event.collectionSources?.some((source) => source.id === supplement.id));
    const matches = events.filter((event) => event.kind === supplement.kind && key(event.title) === key(supplement.title)
      && (!versionOf(event) || !versionOf(supplement) || versionOf(event) === versionOf(supplement))
      // 독립 원본끼리는 이름과 기간 겹침만으로 서로 다른 회차를 축소하지 않도록 제한
      && (event.startAt === supplement.startAt && event.endAt === supplement.endAt
        || officialIds.has(event.id) && !(event.collectionMethod === 'announcement' && supplement.collectionMethod === 'announcement'))
      && Math.max(Date.parse(event.startAt), Date.parse(supplement.startAt)) < Math.min(Date.parse(event.endAt), Date.parse(supplement.endAt)));
    if (!linked && matches.length !== 1) {
      events.push(supplement);
      continue;
    }
    const event = linked ?? matches[0]!;
    // 공식 기간을 유지하면서 독립 출처의 ID·그림·기간 근거를 함께 보존
    events[events.indexOf(event)] = { ...event,
      ...(event.imageUrls?.length ? {} : supplement.imageUrls?.length ? { imageUrls: supplement.imageUrls } : {}),
      collectionSources: [...new Map([...(event.collectionSources ?? []), supplement,
        ...(supplement.collectionSources ?? [])].map((source) => [source.id, { id: source.id, title: source.title,
          startAt: source.startAt, endAt: source.endAt, sourceUrl: source.sourceUrl }])).values()].slice(0, 100) };
  }
  const issues = official.issues.filter((issue) => {
    const item = inventory.find((item) => `${item.id}:period` === issue.id);
    if (!item || /충돌|역전/.test(issue.reason)) return true;
    return !events.some((event) => event.kind === item.kind && key(event.title) === key(item.title)
      && (!item.version || versionOf(event) === item.version));
  });
  return { events, issues };
};
