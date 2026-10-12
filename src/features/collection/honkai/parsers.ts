import { isImageUrl, isRecord, type CalendarEvent, type TimeEvidence } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { parseLocalDate, stripHtml } from '../parsers';
import { createHash } from 'node:crypto';

export interface HonkaiArticle { id: string; title: string; description: string; url: string; createdAt: number; imageUrl?: string; englishDescription?: string }

export const parseHonkaiNews = (raw: unknown): HonkaiArticle[] => {
  if (!Array.isArray(raw)) throw new Error('Unexpected Honkai news schema');
  return raw.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^\d+$/.test(item.id) || typeof item.title !== 'string'
      || typeof item.description !== 'string' || typeof item.created_at !== 'number' || !Number.isFinite(item.created_at)
      || item.created_at <= 0 || typeof item.url !== 'string' || !/^https:\/\//.test(item.url)) throw new Error('Unexpected Honkai news item');
    return { id: item.id, title: item.title, description: item.description, url: item.url, createdAt: item.created_at,
      ...(isImageUrl(item.banner) ? { imageUrl: item.banner } : {}) };
  });
};

export const parseHonkaiPost = (raw: unknown, article: HonkaiArticle, language = 'ko-kr'): HonkaiArticle => {
  if (!isRecord(raw) || raw.retcode !== 0 || !isRecord(raw.data) || !isRecord(raw.data.post) || !isRecord(raw.data.post.post)) {
    throw new Error('Unexpected Honkai post schema');
  }
  const post = raw.data.post.post;
  if (post.lang !== language || post.post_id !== article.id || typeof post.content !== 'string' || !post.content.trim()) {
    throw new Error('Korean Honkai post unavailable');
  }
  return { ...article, description: stripHtml(post.content) };
};

const communityEvent = (article: HonkaiArticle) => /웹\s*이벤트|댓글|추첨|호요랜드|HoYo FEST|오프라인|공모전|굿즈|설문/i.test(article.title)
  || !/버전|보급|테마 이벤트/.test(article.title) && /댓글.*추첨|좋아요.*댓글/.test(article.description);
export const isHonkaiScheduleArticle = (article: HonkaiArticle) => !communityEvent(article)
  && /이벤트|보급|버전.*(?:업데이트|점검)|점검.*안내|코스튬 정보|신규.*캐릭터/.test(article.title);

// 한국 서버 공지의 연도 생략 날짜를 게시 연도와 연말 전환으로 복원
const articleYear = (article: HonkaiArticle, month: number) => {
  const published = new Date(article.createdAt * 1000 + 9 * 3600000);
  const difference = month - (published.getUTCMonth() + 1);
  return published.getUTCFullYear() + (difference < -6 ? 1 : difference > 6 ? -1 : 0);
};

export const parseHonkaiSchedules = (articles: HonkaiArticle[]) => {
  const events: CalendarEvent[] = [];
  const issues: CollectionIssue[] = [];
  const maintenance = new Map<string, { at: string; sourceUrl: string; published: number }[]>();
  for (const article of articles.filter((candidate) => /버전 점검 공지/.test(candidate.title))) {
    const version = /(\d+\.\d+)\s*버전/.exec(article.title)?.[1];
    const time = /(\d+)월\s*(\d+)일\s*\d{1,2}:\d{2}\s*[~～–-]\s*(\d{1,2}:\d{2})\s*\(UTC\+9\)에\s*업데이트 점검/.exec(stripHtml(article.description));
    if (!version || !time) continue;
    const at = parseLocalDate(`${articleYear(article, Number(time[1]))}/${time[1]}/${time[2]} ${time[3]}`, 9);
    if (at) maintenance.set(version, [...maintenance.get(version) ?? [], { at, sourceUrl: article.url, published: article.createdAt }]);
  }
  for (const article of articles.filter(isHonkaiScheduleArticle)) {
    const text = stripHtml(article.description);
    const version = /(\d+\.\d+)\s*버전.*업데이트 공지/.exec(article.title)?.[1];
    const versionDates = version ? /환영해\s*\(\s*(\d+)월\s*(\d+)일\s*[~～–-]\s*(\d+)월\s*(\d+)일\s*\)/.exec(text) : null;
    if (version && versionDates) {
      const startYear = articleYear(article, Number(versionDates[1]));
      const endYear = startYear + (Number(versionDates[3]) < Number(versionDates[1]) ? 1 : 0);
      const dateAt = parseLocalDate(`${startYear}/${versionDates[1]}/${versionDates[2]} 00:00`, 9);
      const update = maintenance.get(version)?.filter((candidate) => dateAt && Date.parse(candidate.at) >= Date.parse(dateAt)
        && Date.parse(candidate.at) < Date.parse(dateAt) + 86400000)
        .sort((a, b) => b.published - a.published || a.sourceUrl.localeCompare(b.sourceUrl))[0];
      const startAt = update?.at ?? dateAt;
      const endAt = parseLocalDate(`${endYear}/${versionDates[3]}/${versionDates[4]} 00:00`, 9);
      if (startAt && endAt && endAt > startAt) events.push({ id: `honkai:version:${version}`, game: 'honkai', kind: 'version',
        title: `${version} 버전`, startAt, endAt, sourceUrl: article.url, sourceLanguage: 'ko-kr', collectionMethod: 'announcement',
        versionEndBasis: 'announced-date', versionEndSourceUrl: article.url,
        description: update ? '공식 점검 공지의 예정 종료 시각으로 버전 시작. 종료 날짜의 점검 시작 시각은 11시 기본 규칙 적용.'
          : '공식 공지에 발표된 버전 날짜에 시작 17시·종료 11시 기본 규칙 적용.',
        timeEvidence: { start: { at: startAt, basis: 'official', precision: update ? 'minute' : 'date', sourceUrl: update?.sourceUrl ?? article.url },
          end: { at: endAt, basis: 'official', precision: 'date', sourceUrl: article.url } },
        ...(article.imageUrl ? { imageUrls: [article.imageUrl] } : {}) });
    }
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    let parsed = 0;
    for (const [index, line] of lines.entries()) {
      if (!/(?:이벤트|보급|개방|도전)\s*(?:기간|시간)/.test(line)) continue;
      const following = lines.slice(index + 1, index + 3);
      const nextHeader = following.findIndex((candidate) => /^(?:★|☆|■)|(?:이벤트|보급|개방|도전)\s*(?:기간|시간)/.test(candidate));
      const section = [line, ...(nextHeader < 0 ? following : following.slice(0, nextHeader))].join(' ');
      const range = /(?:(\d{4})년\s*)?(\d+)월\s*(\d+)일\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:\((?:한국 시간|KST|UTC\+9)\))?\s*[~～–-]\s*(?:(\d{4})년\s*)?(\d+)월\s*(\d+)일\s*(\d{1,2}:\d{2}(?::\d{2})?)/.exec(section);
      if (!range || /UTC\+8|서버 시간/.test(section)) continue;
      const startYear = range[1] ? Number(range[1]) : articleYear(article, Number(range[2]));
      const endYear = range[5] ? Number(range[5]) : startYear + (Number(range[6]) < Number(range[2]) ? 1 : 0);
      const startAt = parseLocalDate(`${startYear}/${range[2]}/${range[3]} ${range[4]}`, 9);
      const endAt = parseLocalDate(`${endYear}/${range[6]}/${range[7]} ${range[8]}`, 9);
      if (!startAt || !endAt || endAt <= startAt) continue;
      const heading = lines.slice(0, index).reverse().find((candidate) => /^(?:★|☆|【|■)/.test(candidate)
        && /이벤트|보급|도전/.test(candidate));
      const title = heading?.replace(/^[★☆■\s]+|[☆\s]+$/g, '') ?? article.title;
      const evidence = (at: string, time: string): TimeEvidence => ({ at, basis: 'official',
        precision: time.split(':').length === 3 ? 'second' : 'minute', sourceUrl: article.url });
      events.push({ id: `honkai:announcement:${article.id}:${index}:${startAt}`, game: 'honkai',
        kind: /보급/.test(line) ? 'banner' : /도전/.test(line) ? 'challenge' : 'event', title, startAt, endAt,
        sourceUrl: article.url, sourceLanguage: 'ko-kr', collectionMethod: 'announcement', description: section,
        timeEvidence: { start: evidence(startAt, range[4]!), end: evidence(endAt, range[8]!) },
        ...(article.imageUrl ? { imageUrls: [article.imageUrl] } : {}) });
      parsed++;
    }
    const candidates = lines.flatMap((line) => {
      const item = /^(.{2,100}?)\s*\|\s*(.+)$/.exec(line);
      return item && /이벤트|보급|로그인|BP|복귀/.test(line) ? [{ title: item[1]!.trim(), excerpt: line }] : [];
    });
    for (const candidate of candidates) {
      const hash = createHash('sha256').update(candidate.title).digest('hex').slice(0, 16);
      issues.push({ id: `honkai:announcement:${article.id}:candidate:${hash}`, game: 'honkai', title: candidate.title,
        reason: '개방 안내는 있으나 시작·종료 기간 미공개. 인게임 기간 확인 후 일정 추가 필요', sourceUrl: article.url, excerpt: candidate.excerpt });
    }
    if (!parsed && !candidates.length) issues.push({ id: `honkai:announcement:${article.id}:period`, game: 'honkai', title: article.title,
      reason: '이벤트·보급의 확정된 시작·종료 시각 미수집. 이미지 또는 업데이트 후 표기 확인 필요', sourceUrl: article.url, excerpt: text.slice(0, 6000) });
  }
  const uniqueIssues = [...new Map(issues.map((issue) => [issue.id, issue])).values()];
  return { events: [...new Map(events.map((event) => [event.id, event])).values()], issues: uniqueIssues, skipped: uniqueIssues.length };
};
