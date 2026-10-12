import { fetchJson } from '../http';
import type { CollectionIssue } from '../../../../shared/admin';
import { isHonkaiScheduleArticle, parseHonkaiNews, parseHonkaiPost, parseHonkaiSchedules } from './parsers';
import { fetchHonkaiCafe, HONKAI_CAFE_URL } from './cafe';
import { fetchHonkaiPublicTimeline, HONKAI_TIMELINE_BASE } from './public';
import { scheduleTitleKey } from '../reconciliation';
import { fetchLinkedHonkaiArticles } from './linked';
import { applyHonkaiTimeRules } from './custom/time-rules';
import { supplementHonkaiAuditedSchedules } from './custom/audited-schedules';

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
      if (/버전.*업데이트 공지/.test(article.title)) {
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
  const parsed = parseHonkaiSchedules(officialArticles);
  const versions = parsed.events.filter((event) => event.kind === 'version' && Date.parse(event.endAt) > Date.now() - 100 * 86400000);
  for (const version of versions) {
    try {
      const timeline = await fetchHonkaiPublicTimeline(version, officialArticles);
      const added = timeline.events.filter((candidate) => !parsed.events.some((event) => !event.periodBasis && event.kind === candidate.kind
        && scheduleTitleKey(event) === scheduleTitleKey(candidate) && Date.parse(event.endAt) > Date.parse(candidate.startAt)
        && Date.parse(event.startAt) < Date.parse(candidate.endAt)));
      parsed.events.push(...added);
      issues.push(...timeline.issues);
    } catch (error) {
      console.error('[honkai] public timeline unavailable', error);
      issues.push({ id: `honkai:timeline:fetch:${version.id}`, game: 'honkai', title: '공개 예상 일정 수집 실패',
        reason: '지역 서버용 일정 데이터 또는 한국 버전 기간 대조 실패. 다음 수집에서 재시도', sourceUrl: HONKAI_TIMELINE_BASE, excerpt: '' });
    }
  }
  issues.push(...parsed.issues.filter((issue) => !issue.id.includes(':candidate:') || !parsed.events.some((event) =>
    event.title === issue.title || event.title.startsWith(`${issue.title} · `))), { id: 'honkai:coverage', game: 'honkai', title: '붕괴3rd 자동 수집 범위',
    reason: '한국 공식 공지·카페와 AruStats 지역 서버용 예상 일정 자동 대조. 한국 공지에 없는 콘텐츠는 제외. 예상 기간은 실제 종료 시각과 다를 수 있음',
    sourceUrl: HONKAI_CAFE_URL, excerpt: '' });
  const events = applyHonkaiTimeRules(supplementHonkaiAuditedSchedules(parsed.events, officialArticles));
  for (const event of events.filter((event) => event.kind !== 'version'
    && (event.timeEvidence?.start?.precision === 'date' || event.timeEvidence?.end?.precision === 'date'))) {
    issues.push({ id: `honkai:time-rule:${event.id}`, game: 'honkai', title: event.title, sourceUrl: event.sourceUrl,
      reason: '시각 규칙 적용 시 기간 역전 또는 근거 불일치. 원본 날짜 유지 및 새 공식 시각 수집 필요', excerpt: `${event.startAt} ~ ${event.endAt}` });
  }
  const estimated = events.filter((event) => event.periodBasis).length;
  const verified = events.filter((event) => event.kind !== 'version' && !event.periodBasis).length;
  return { events, issues,
    skipped: issues.filter((issue) => issue.id.includes(':period') || issue.id.includes(':candidate:')).length,
    partial: true, collectorRevision: 6,
    message: `이벤트·픽업 ${verified + estimated}개 자동 수집: 공식 기간 ${verified}개 · 예상 기간 ${estimated}개. 한국 공지 우선, 버전 17시 시작·11시 종료, 이벤트 04시·보급 12시 기본값 적용.` };
};
