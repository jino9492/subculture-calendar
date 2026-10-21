import { fetchJson } from '../http';
import type { CollectionIssue } from '../../../../shared/admin';
import { isHonkaiScheduleArticle, parseHonkaiNews, parseHonkaiPost, parseHonkaiSchedules, type HonkaiArticle } from './parsers';
import { fetchHonkaiCafe, HONKAI_CAFE_URL } from './cafe';
import { fetchHonkaiPublicTimeline, HONKAI_TIMELINE_BASE } from './public';
import { fetchLinkedHonkaiArticles } from './linked';
import { applyHonkaiTimeRules } from './custom/time-rules';
import { collectHonkaiOfficialItems, mergeHonkaiScheduleSources, resolveHonkaiOfficialItems } from './official';
import { supplementHonkaiAuditedSchedules } from './custom/audited-schedules';
import type { CalendarEvent } from '../../../../shared/calendar';

export const fetchHonkai = async () => {
  const base = process.env.HOYO_API_BASE ?? 'https://api.ennead.cc/mihoyo/';
  const categories = ['notices', 'info', 'events'];
  const [cafe, results] = await Promise.all([fetchHonkaiCafe(), Promise.allSettled(categories.map(async (category) =>
    parseHonkaiNews(await fetchJson(new URL(`honkai/news/${category}?lang=ko-kr`, base)))))]);
  if (!cafe.available && results.every((result) => result.status === 'rejected')) throw new Error('Honkai Korean news unavailable');
  const issues: CollectionIssue[] = [...cafe.issues];
  const articles = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    issues.push({ id: `honkai:fetch:${categories[index]}`, game: 'honkai', title: '한국어 뉴스 수집 실패',
      reason: '뉴스 목록 수집 실패. 재수집 필요', sourceUrl: new URL(`honkai/news/${categories[index]}?lang=ko-kr`, base).href, excerpt: '' });
    return [];
  });
  const relevant = [...new Map(articles.filter((article) => article.createdAt * 1000 > Date.now() - 100 * 86400000
    && isHonkaiScheduleArticle(article)).map((article) => [article.id, article])).values()];
  const fullArticles = [];
  for (let offset = 0; offset < relevant.length; offset += 4) {
    const batch = relevant.slice(offset, offset + 4);
    const posts = await Promise.allSettled(batch.map(async (article) => {
      const url = new URL('https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull');
      url.searchParams.set('post_id', article.id);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'x-rpc-language': 'ko-kr' } });
      if (!response.ok) throw new Error(`Honkai post HTTP ${response.status}`);
      const korean = parseHonkaiPost(await response.json(), article);
      if (/버전.*(?:업데이트 공지|이벤트 일람)/.test(article.title)) {
        try {
          const original = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'x-rpc-language': 'en-us' } });
          if (original.ok) korean.englishDescription = parseHonkaiPost(await original.json(), article, 'en-us').description;
        } catch { /* 한국어 공지는 유지하고 영문 이름 대조만 생략 */ }
      }
      return korean;
    }));
    for (const [index, post] of posts.entries()) {
      const article = batch[index]!;
      if (post.status === 'fulfilled') fullArticles.push(post.value);
      else {
        fullArticles.push(article);
        issues.push({ id: `honkai:fetch:post:${article.id}`, game: 'honkai', title: article.title,
          reason: '한국어 전체 공지 수집 실패. 뉴스 요약만 확인 가능', sourceUrl: article.url, excerpt: article.description });
      }
    }
  }
  const linked = await fetchLinkedHonkaiArticles(cafe.articles);
  const officialArticles = [...new Map([...linked, ...fullArticles, ...cafe.articles].map((article) => [article.id, article])).values()];
  return collectHonkaiArticleSchedules(officialArticles, { issues });
};

export const collectHonkaiArticleSchedules = async (officialArticles: HonkaiArticle[], options: {
  now?: number;
  issues?: CollectionIssue[];
  fetchTimeline?: typeof fetchHonkaiPublicTimeline;
} = {}) => {
  const issues = [...(options.issues ?? [])];
  const now = options.now ?? Date.now();
  const parsed = parseHonkaiSchedules(officialArticles);
  const inventory = collectHonkaiOfficialItems(officialArticles, parsed.events);
  const supplements: CalendarEvent[] = [];
  let skipped = 0;
  const versions = parsed.events.filter((event) => event.kind === 'version' && Date.parse(event.endAt) > now - 100 * 86400000);
  for (const version of versions) {
    try {
      const timeline = await (options.fetchTimeline ?? fetchHonkaiPublicTimeline)(version, officialArticles, true);
      parsed.events[parsed.events.indexOf(version)] = timeline.version;
      supplements.push(...timeline.events);
      issues.push(...timeline.issues);
      skipped += timeline.skipped;
    } catch (error) {
      console.error('[honkai] public timeline unavailable', error);
      issues.push({ id: `honkai:timeline:fetch:${version.id}`, game: 'honkai', title: '공개 예상 일정 수집 실패',
        reason: '지역 서버용 일정 데이터 또는 한국 버전 기간 대조 실패. 다음 수집에서 재시도', sourceUrl: HONKAI_TIMELINE_BASE, excerpt: '' });
    }
  }
  const collectedVersions = parsed.events.filter((event) => event.kind === 'version');
  const officialPeriods = inventory.flatMap((item) => item.periods);
  const audited = supplementHonkaiAuditedSchedules([...collectedVersions, ...officialPeriods, ...supplements], officialArticles)
    .filter((event) => event.kind !== 'version');
  const resolved = mergeHonkaiScheduleSources(resolveHonkaiOfficialItems(inventory, audited), audited, inventory);
  issues.push(...resolved.issues, { id: 'honkai:coverage', game: 'honkai', title: '붕괴3rd 자동 수집 범위',
    reason: '공식 공지와 공개 원본을 독립 수집 후 병합. 이름·분류·한국 기간 대조 실패도 원본 표시를 막지 않으며 원문과 예상 기간 유지. 공식 정보는 별도로 보완하고 미연결·충돌은 관리자에 유지',
    sourceUrl: HONKAI_CAFE_URL, excerpt: '' });
  const events = applyHonkaiTimeRules([...parsed.events.filter((event) => event.kind === 'version'), ...resolved.events]);
  for (const event of events.filter((event) => event.kind !== 'version'
    && (event.timeEvidence?.start?.precision === 'date' || event.timeEvidence?.end?.precision === 'date'))) {
    issues.push({ id: `honkai:time-rule:${event.id}`, game: 'honkai', title: event.title, sourceUrl: event.sourceUrl,
      reason: '시각 규칙 적용 시 기간 역전 또는 근거 불일치. 원본 날짜 유지 및 새 공식 시각 수집 필요', excerpt: `${event.startAt} ~ ${event.endAt}` });
  }
  const schedules = events.filter((event) => event.kind !== 'version');
  const estimated = schedules.filter((event) => event.periodBasis).length;
  const verified = schedules.length - estimated;
  const unlinked = schedules.filter((event) => !event.crossChecked).length;
  return { events, issues,
    skipped: skipped + resolved.issues.length,
    partial: true, collectorRevision: 15,
    message: `공식 목록 ${inventory.length}개 · 표시 일정 ${schedules.length}개(공식 기간 ${verified}개 · 공개 원본 기간 ${estimated}개) · 이름·기간 미대조 ${unlinked}개 원문 표시 · 공식 기간 미확정 ${resolved.issues.length}개 관리자 확인.` };
};
