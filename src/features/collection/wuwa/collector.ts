import { isRecord } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { buildVersionEvents, stripHtml, type CollectionArticle, type VersionBoundary } from '../parsers';
import { parseWuwaKoreanBoundary, parseWuwaKoreanEvents, parseWuwaBannerAliases, WUWA_END_CONTENT } from './localized';
import { parseWuwaNaverFeed } from './naver';
import { collectWuwaChallengeCycles } from './custom/challenge-cycles';
import { loadKoreanNames, rememberKoreanNames, learnKoreanScheduleNames } from '../names';
import { parseWuwaStructuredCalendar, wuwaAsiaIndex, WUWA_PUBLIC_EVENTS_URL } from './public';
import { linkWuwaSources } from './priority';
import { fetchJson } from '../http';

const fetchWuwaStructured = async () => {
  const base = process.env.WUWA_WIKI_API_BASE ?? 'https://wuwa.wiki/';
  let names = await loadKoreanNames('wuwa');
  let korean: ReturnType<typeof parseWuwaStructuredCalendar> = { events: [], issues: [], skipped: 0, missing: ['종말 매트릭스', '역경의 탑', '죽음의 노래와 바닷속 폐허'] };
  let failed = false;
  try {
    const config = await fetchJson(new URL('api/getconfig', base));
    if (!isRecord(config) || config.code !== 1000 || !isRecord(config.data) || typeof config.data.resourceVersion !== 'string'
      || !/^\d+\.\d+\.\d+$/.test(config.data.resourceVersion)) throw new Error('Invalid wiki config');
    const query = new URLSearchParams({ ver: config.data.resourceVersion, lang: 'ko' });
    const commonUrl = new URL(`api/events/timeline/getcommon?${query}`, base);
    const response = await fetchJson(commonUrl);
    if (!isRecord(response) || response.code !== 1000 || !isRecord(response.data) || !Array.isArray(response.data.versions)) throw new Error('Invalid wiki common data');
    const common = response.data;
    if (!Array.isArray(common.versions)) throw new Error('Invalid wiki versions');
    const serverIndex = wuwaAsiaIndex(common.servers);
    const versions = [...new Set(common.versions.filter(isRecord).flatMap((row) => {
      const time = Array.isArray(row.time) && Array.isArray(row.time[serverIndex]) ? row.time[serverIndex] : [];
      const version = typeof row.devTitle === 'string' ? /^ver_(\d+\.\d+)_/.exec(row.devTitle)?.[1] : undefined;
      return version && typeof time[1] === 'string' && Date.parse(time[1]) > Date.now() - 100 * 86400000 ? [version] : [];
    }))];
    const list: unknown[] = [];
    for (const version of versions) {
      try {
        const detailUrl = new URL(`api/events/timeline/getversiondetail?${query}&id=${version}`, base);
        const result = await fetchJson(detailUrl);
        if (!isRecord(result) || result.code !== 1000 || !Array.isArray(result.data)) throw new Error('Invalid wiki version data');
        list.push(...result.data.filter(isRecord).map((group) => ({ ...group, sourceUrl: detailUrl.href })));
      } catch (error) { failed = true; console.error(`[wuwa] Korean structured version ${version} unavailable`, error); }
    }
    if (isRecord(common.events)) list.push(common.events);
    else if (Array.isArray(common.events)) list.push(...common.events);
    korean = parseWuwaStructuredCalendar({ servers: common.servers, list }, common, commonUrl.href, names);
    names = learnKoreanScheduleNames(korean.events, names);
    try { await rememberKoreanNames('wuwa', korean.events); }
    catch (error) { console.error('[wuwa] names save failed', error); }
  } catch (error) { failed = true; console.error('[wuwa] Korean structured API unavailable', error); }
  const originalUrl = process.env.WUWA_PUBLIC_EVENTS_URL ?? WUWA_PUBLIC_EVENTS_URL;
  const calendarUrl = process.env.WUWA_PUBLIC_CALENDAR_URL ?? new URL('calendar.json', originalUrl).href;
  try {
    const [raw, calendar] = await Promise.all([fetchJson(new URL(originalUrl)), fetchJson(new URL(calendarUrl))]);
    const original = parseWuwaStructuredCalendar(raw, calendar, originalUrl, names, 'und');
    const events = [...korean.events, ...original.events];
    return { events, issues: [...korean.issues, ...original.issues.filter((issue) => !events.some((event) => event.id === issue.eventId && event.displayLanguage === 'ko-kr'))],
      skipped: korean.skipped, failed, originalCount: events.length - korean.events.length };
  } catch (error) {
    console.error('[wuwa] original structured API unavailable', error);
    if (!korean.events.length) throw new Error('Wuwa structured APIs unavailable');
    return { events: korean.events, issues: korean.issues, skipped: korean.skipped, failed: true, originalCount: 0 };
  }
};

const fetchWuwaKorean = async () => {
  const locale = 'kr';
  const base = process.env.WUWA_KR_CDN_BASE ?? 'https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/kr/';
  const menu = await fetchJson(new URL('ArticleMenu.json', base));
  if (!Array.isArray(menu)) throw new Error('Unexpected article menu');
  const cutoff = Date.now() - 100 * 86400000;
  const selected = menu.filter(isRecord).filter((item) => typeof item.articleTitle === 'string'
    && typeof item.createTime === 'string' && Date.parse(`${item.createTime.replace(' ', 'T')}+08:00`) > cutoff
    && (/Event|Convene|Challenge|Update Maintenance Notice|Version.*Update|이벤트|튜닝|버전.*업데이트|점검/i.test(item.articleTitle) || WUWA_END_CONTENT.test(item.articleTitle))
    && !/Fan Creation|Winners|Photography|Battle Rush|Discord|팬아트|당첨자/i.test(item.articleTitle))
    .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime))).slice(0, 80);
  const articles: CollectionArticle[] = [];
  const issues: CollectionIssue[] = [];
  let failed = 0;
  // 공식 CDN 부담을 줄이기 위한 최대 4개 동시 요청
  for (let offset = 0; offset < selected.length; offset += 4) {
    const batch = selected.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map(async (item) => {
      const id = String(item.articleId);
      if (!/^\d+$/.test(id)) throw new Error('Invalid article id');
      const article = await fetchJson(new URL(`article/${id}.json`, base));
      if (!isRecord(article) || typeof article.articleContent !== 'string' || typeof item.articleTitle !== 'string') throw new Error('Unexpected article');
      return { id, title: item.articleTitle, content: article.articleContent,
        ...(typeof item.startTime === 'string' ? { publishedAt: item.startTime } : {}) };
    }));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') articles.push(result.value);
      else { failed++; console.error('[wuwa] article unavailable', result.reason);
        const item = batch[index];
        if (item) issues.push({ id: `wuwa:${locale}:fetch:${String(item.articleId)}`, game: 'wuwa', title: String(item.articleTitle),
          reason: '공지 본문 수집 실패. 원문 확인 또는 재수집이 필요합니다.', sourceUrl: `https://wutheringwaves.kurogames.com/${locale}/main/news/detail/${String(item.articleId)}`, excerpt: '' });
      }
    }
  }
  if (selected.length && failed === selected.length) throw new Error('All articles unavailable');
  const boundaries = articles.flatMap((article) => { const boundary = parseWuwaKoreanBoundary(article); return boundary ? [boundary] : []; });
  const parsed = articles.filter((article) => !/Update Maintenance Notice/i.test(article.title))
    .map((article) => {
      const result = parseWuwaKoreanEvents(article, boundaries);
      if (result.skipped) issues.push({ id: `wuwa:${locale}:period:${article.id}`, game: 'wuwa', title: article.title,
        reason: `이 공지에서 ${result.skipped}개 기간을 읽지 못했습니다. 이미지·상대 기간을 원문에서 확인하세요.`,
        sourceUrl: `https://wutheringwaves.kurogames.com/${locale}/main/news/detail/${article.id}`, excerpt: stripHtml(article.content).slice(0, 6000) });
      return { ...result, publishedAt: article.publishedAt };
    });
  const events = [...buildVersionEvents('wuwa', boundaries).map((event) => ({ ...event, sourceLanguage: 'ko-kr' })), ...parsed.flatMap((item) => item.events)];
  const skipped = parsed.reduce((sum, item) => sum + item.skipped, 0) + failed;
  const bannerPublications = Object.fromEntries(parsed.flatMap((item) => {
    const publishedAt = item.publishedAt;
    return publishedAt ? item.events.map((event) => [event.id, publishedAt]) : [];
  }));
  return { events, skipped, issues, bannerPublications, boundaries, bannerAliases: articles.flatMap(parseWuwaBannerAliases) };
};

const fetchWuwaNaver = async (cdnBoundaries: VersionBoundary[]) => {
  const base = process.env.WUWA_NAVER_API_BASE ?? 'https://comm-api.game.naver.com/nng_main/v1/';
  const articles: CollectionArticle[] = [];
  const issues: CollectionIssue[] = [];
  let failed = 0;
  for (let page = 0; page < 8; page++) {
    const response = await fetchJson(new URL(`community/lounge/WutheringWaves/feed?boardId=28&offset=${page}&limit=30&order=NEW&buffFilteringYN=N`, base));
    if (!isRecord(response) || response.code !== 200 || !isRecord(response.content) || !Array.isArray(response.content.feeds)) throw new Error('Unexpected Naver list');
    const feeds = response.content.feeds;
    let oldest = Date.now();
    for (const entry of feeds) {
      try {
        const article = parseWuwaNaverFeed(entry);
        if (!article) continue;
        const published = Date.parse(article.publishedAt ?? '');
        oldest = Math.min(oldest, published);
        if (published > Date.now() - 100 * 86400000 && (/이벤트|튜닝|점검|버전.*업데이트/.test(article.title) || WUWA_END_CONTENT.test(article.title))) articles.push(article);
      } catch (error) { failed++; console.error('[wuwa] Naver document unavailable', error); }
    }
    if (feeds.length < 30 || oldest <= Date.now() - 100 * 86400000) break;
  }
  const boundaries = [...new Map([...cdnBoundaries, ...articles.flatMap((article) => {
    const boundary = parseWuwaKoreanBoundary(article); return boundary ? [boundary] : [];
  })].map((boundary) => [boundary.version, boundary])).values()];
  const parsed = articles.map((article) => {
    const result = parseWuwaKoreanEvents(article, boundaries);
    if (result.skipped) issues.push({ id: `wuwa:kr:period:${article.id}`, game: 'wuwa', title: article.title,
      reason: `이 공지에서 ${result.skipped}개 기간을 읽지 못했습니다. 원문 확인이 필요합니다.`, sourceUrl: article.sourceUrl ?? '', excerpt: stripHtml(article.content).slice(0, 6000) });
    return result;
  });
  return { events: [...buildVersionEvents('wuwa', boundaries).map((event) => ({ ...event, sourceLanguage: 'ko-kr' })), ...parsed.flatMap((item) => item.events)], issues, skipped: failed + parsed.reduce((sum, item) => sum + item.skipped, 0),
    completeBannerPeriods: parsed.filter((item) => item.skipped === 0).flatMap((item) => item.completeBannerPeriods), bannerAliases: articles.flatMap(parseWuwaBannerAliases) };
};

export const fetchWuwa = async () => {
  let structured: Awaited<ReturnType<typeof fetchWuwaStructured>> = { events: [], issues: [], skipped: 0, failed: true, originalCount: 0 };
  try { structured = await fetchWuwaStructured(); }
  catch (error) { console.error('[wuwa] structured collection unavailable, using notices', error); }
  const [krResult] = await Promise.allSettled([fetchWuwaKorean()]);
  const korean = krResult?.status === 'fulfilled' ? krResult.value
    : { events: [], issues: [], skipped: 0, bannerPublications: {}, boundaries: [], bannerAliases: [] };
  let naverFailed = false;
  let naver: Awaited<ReturnType<typeof fetchWuwaNaver>> = { events: [], issues: [], skipped: 0, completeBannerPeriods: [], bannerAliases: [] };
  try { naver = await fetchWuwaNaver(korean.boundaries); }
  catch (error) { naverFailed = true; console.error('[wuwa] official lounge unavailable', error); }
  if (krResult?.status === 'rejected' && naverFailed && !structured.events.length) throw new Error('Wuwa sources unavailable');
  const naverVersionIds = new Set(naver.events.filter((event) => event.kind === 'version').map((event) => event.id));
  korean.events = korean.events.filter((event) => !naverVersionIds.has(event.id));
  korean.events.push(...naver.events);
  korean.issues.push(...naver.issues);
  korean.skipped += naver.skipped;
  let events = linkWuwaSources(structured.events, korean.events, [...korean.bannerAliases, ...naver.bannerAliases]);
  let challengeIncomplete = new Set(events.filter((event) => event.kind === 'challenge').map((event) => event.localizationKey ?? event.title)).size < 3;
  const challengeUrl = process.env.WUWA_ENDGAME_FEED_URL;
  if (challengeUrl && challengeIncomplete) {
    try {
      const challenges = await collectWuwaChallengeCycles(await fetchJson(new URL(challengeUrl)), challengeUrl);
      events = [...events, ...challenges.events];
      challengeIncomplete = challenges.missing.length > 0;
    } catch (error) { console.error('[wuwa] challenge source unavailable', error); }
  }
  const issues = [...structured.issues, ...korean.issues];
  const skipped = structured.skipped + korean.skipped;
  return { events, issues, skipped, partial: challengeIncomplete || structured.failed || naverFailed || skipped > 0 || issues.length > 0,
    message: `한국어 구조화 API 우선 · 원본 구조화+한국어 이름 ${structured.originalCount}개 보완 · 공식 공지는 누락만 보완. ${skipped}개 기간 확인 필요. ${events.filter((event) => event.versionEndBasis === 'default-42-days').length}개 버전 42일 기본값. ${challengeIncomplete ? '일부 엔드콘텐츠 미수집.' : '엔드콘텐츠 3종 수집.'}` };
};
