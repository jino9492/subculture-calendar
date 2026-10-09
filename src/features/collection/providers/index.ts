import { isImageUrl, isRecord, type GameId } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { buildVersionEvents, parseHoyoCalendar, parseHoyoVersions, stripHtml, type WuwaArticle } from './parsers';
import { parseEndfieldBoundary, parseEndfieldEvents, parseEndfieldNewsList, parseWuwaKoreanBoundary, parseWuwaKoreanEvents, parseWuwaBannerAliases, WUWA_END_CONTENT } from './localized';
import { hoyoAnnouncementUrl, parseHoyoAnnouncements, supplementHoyoCalendar } from './announcements';
import { parseWuwaNaverFeed } from './naver';
import { collectWuwaChallengeCycles } from '../challenge-cycles';
import { loadKoreanNames, attachHoyoNames, rememberKoreanNames, learnKoreanScheduleNames } from '../names';
import { parseWuwaStructuredCalendar, wuwaAsiaIndex, WUWA_PUBLIC_EVENTS_URL } from './wuwa-public';
import { mergeHoyoStructured, linkWuwaSources } from '../priority';
import type { VersionBoundary } from './parsers';
import { SRA_GAMES, supplementStructuredVersion, parseStructuredActivities, learnStructuredActivityNames } from './sra';

export const fetchJson = async (url: URL): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
};

const fetchStructuredVersion = async (game: Exclude<GameId, 'wuwa'>) => {
  const url = new URL(`activity/${SRA_GAMES[game]}-en-US.json`, process.env.SRA_API_BASE ?? 'https://starrailassistant.top/api/v1/');
  try { return { raw: await fetchJson(url), sourceUrl: url.href }; }
  catch (error) { console.error(`[${game}] original version API unavailable`, error); return null; }
};

const fetchHoyo = async (game: Exclude<GameId, 'wuwa' | 'endfield'>) => {
  const structuredVersion = await fetchStructuredVersion(game);
  const base = process.env.HOYO_API_BASE ?? 'https://api.ennead.cc/mihoyo/';
  let calendarUrl = new URL(`${game}/calendar?lang=ko-kr`, base);
  const names = await loadKoreanNames(game);
  let language: 'ko-kr' | 'en-us' = 'ko-kr';
  let structuredRepaired = 0;
  let originalCalendar: unknown;
  let parsed: ReturnType<typeof parseHoyoCalendar>;
  try {
    const korean = await fetchJson(calendarUrl);
    parsed = parseHoyoCalendar(game, attachHoyoNames(game, korean, names, language), calendarUrl.href);
    try {
      const originalUrl = new URL(`${game}/calendar?lang=en-us`, base);
      originalCalendar = await fetchJson(originalUrl);
      const supplemented = mergeHoyoStructured(game, korean, originalCalendar, calendarUrl.href, originalUrl.href, names);
      parsed = supplemented;
      structuredRepaired = supplemented.repaired;
    } catch (error) { console.error(`[${game}] structured supplement unavailable`, error); }
  }
  catch (error) {
    console.error(`[${game}] Korean calendar unavailable, trying structured fallback`, error);
    language = 'en-us';
    calendarUrl = new URL(`${game}/calendar?lang=en-us`, base);
    parsed = parseHoyoCalendar(game, attachHoyoNames(game, await fetchJson(calendarUrl), names, language), calendarUrl.href, language);
  }
  let supplementaryFailed = false;
  let announcements: ReturnType<typeof parseHoyoAnnouncements> = [];
  let originalAnnouncements: ReturnType<typeof parseHoyoAnnouncements> = [];
  let versions: VersionBoundary[] = [];
  try {
    const announcementUrl = hoyoAnnouncementUrl(game);
    announcements = parseHoyoAnnouncements(await fetchJson(announcementUrl), announcementUrl.href);
    versions = parseHoyoVersions(announcements);
    try {
      const originalUrl = hoyoAnnouncementUrl(game, 'en-us');
      originalAnnouncements = parseHoyoAnnouncements(await fetchJson(originalUrl), originalUrl.href, 'en-us');
    } catch (error) { console.error(`[${game}] bilingual announcement names unavailable`, error); }
  } catch (error) { supplementaryFailed = true; console.error(`[${game}] official announcements unavailable`, error); }
  try {
    const notices = await fetchJson(new URL(`${game}/news/notices?lang=ko-kr`, base));
    let noticeVersions = parseHoyoVersions(notices);
    const latest = [...versions, ...noticeVersions].sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
    if (!latest?.endAt) {
      const extra = await Promise.allSettled(['info', 'events'].map((category) => fetchJson(new URL(`${game}/news/${category}?lang=ko-kr`, base))));
      const articles: unknown[] = Array.isArray(notices) ? [...notices] : [];
      for (const result of extra) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) articles.push(...result.value);
        else { supplementaryFailed = true; console.error(`[${game}] supplementary version source unavailable`); }
      }
      noticeVersions = parseHoyoVersions(articles);
    }
    const merged = new Map(versions.map((boundary) => [boundary.version, boundary]));
    for (const boundary of noticeVersions) {
      const previous = merged.get(boundary.version);
      merged.set(boundary.version, previous?.endAt && !boundary.endAt ? previous : boundary);
    }
    versions = [...merged.values()];
  } catch (error) {
    console.error(`[${game}] version notices unavailable`, error);
    supplementaryFailed = true;
  }
  if (structuredVersion) {
    try {
      const dictionary = learnStructuredActivityNames(game, originalCalendar, learnKoreanScheduleNames(parsed.events, names), announcements, originalAnnouncements);
      const supplementary = parseStructuredActivities(structuredVersion.raw, structuredVersion.sourceUrl, game, dictionary);
      parsed.events = [...parsed.events, ...supplementary.events];
      parsed.issues.push(...supplementary.issues);
      try { await rememberKoreanNames(game, supplementary.events); }
      catch (error) { console.error(`[${game}] supplementary names save failed`, error); }
    } catch (error) { supplementaryFailed = true; console.error(`[${game}] original activity validation failed`, error); }
  }
  parsed = supplementHoyoCalendar(game, parsed, announcements, versions);
  parsed.events.push(...buildVersionEvents(game, versions));
  if (structuredVersion) {
    try { parsed.events = supplementStructuredVersion(parsed.events, structuredVersion.raw, structuredVersion.sourceUrl, game); }
    catch (error) { console.error(`[${game}] original version validation failed`, error); }
  }
  try { await rememberKoreanNames(game, parsed.events); }
  catch (error) { console.error(`[${game}] Korean names save failed`, error); }
  const versionFailed = versions.length === 0;
  const defaultVersions = parsed.events.filter((event) => event.versionEndBasis === 'default-42-days').length;
  return { ...parsed, partial: language !== 'ko-kr' || versionFailed || supplementaryFailed || defaultVersions > 0 || parsed.skipped > 0 || parsed.issues.length > 0,
    message: `${language === 'en-us' ? '영문 구조화 API를 저장된 한국어 이름으로 변환. ' : '한국어 구조화 API 우선 · 누락은 원본 구조화 API 대조 후 공식 공지 보완. '}${structuredRepaired ? `${structuredRepaired}개 원본 구조화 기간 보완. ` : ''}${parsed.skipped ? `기간이 없는 ${parsed.skipped}개 항목 제외. ` : ''}${versionFailed ? '버전 시작 정보 수집 누락. ' : ''}${defaultVersions ? `${defaultVersions}개 버전은 종료 시각 수집 누락으로 42일 기본값 적용. ` : ''}${supplementaryFailed ? '보완 공지 수집 실패. ' : ''}제공된 현재·예정 일정만 표시.` };
};

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
  const articles: WuwaArticle[] = [];
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
  const articles: WuwaArticle[] = [];
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

const fetchWuwa = async () => {
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

const fetchHtml = async (url: URL) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`News HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 2000000) throw new Error('News document too large');
  return html;
};

const fetchEndfield = async () => {
  const structuredVersion = await fetchStructuredVersion('endfield');
  const base = process.env.ENDFIELD_NEWS_BASE ?? 'https://endfield.gryphline.com/ko-kr/news/';
  const cms = process.env.ENDFIELD_CMS_BASE ?? 'https://web-news.gryphline.com/';
  let cmsAvailable = true;
  let news: WuwaArticle[] = [];
  const issues: CollectionIssue[] = [];
  try {
    for (let page = 1; page <= 50; page++) {
      const response = await fetchJson(new URL(`api/bulletin?lang=ko-kr&code=arknights_endfield_official&page=${page}&pageSize=20`, cms));
      if (!isRecord(response) || response.code !== 0 || !isRecord(response.data) || !Array.isArray(response.data.list)
        || typeof response.data.total !== 'number') throw new Error('Unexpected Endfield CMS list');
      const items = response.data.list.filter(isRecord);
      news.push(...items.flatMap((item) => typeof item.cid === 'string' && /^\d+$/.test(item.cid)
        && typeof item.title === 'string' && typeof item.displayTime === 'number' && item.displayTime * 1000 > Date.now() - 100 * 86400000
        ? [{ id: item.cid, title: item.title, content: '', publishedAt: new Date(item.displayTime * 1000).toISOString(),
          ...(isImageUrl(item.cover) ? { imageUrl: item.cover } : {}) }] : []));
      if (page * 20 >= response.data.total || items.every((item) => item.sticky !== true
        && typeof item.displayTime === 'number' && item.displayTime * 1000 <= Date.now() - 100 * 86400000)) break;
      if (page === 50) issues.push({ id: 'endfield:pagination', game: 'endfield', title: '뉴스 목록 수집 범위 확인',
        reason: '뉴스 목록이 안전 요청 한도 50페이지를 초과했습니다. 이후 페이지 재수집이 필요합니다.', sourceUrl: cms, excerpt: '' });
    }
  } catch (error) {
    console.error('[endfield] CMS list unavailable', error);
    cmsAvailable = false;
    news = parseEndfieldNewsList(await fetchHtml(new URL(base))).map((item) => ({ ...item, content: '' }));
  }
  const list = [...new Map(news.map((item) => [item.id, item])).values()];
  const articles: WuwaArticle[] = [];
  let failed = 0;
  for (let offset = 0; offset < list.length; offset += 4) {
    const batch = list.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map(async (article) => {
      if (!cmsAvailable) return { ...article, content: await fetchHtml(new URL(article.id, base)) };
      try {
        const result = await fetchJson(new URL(`api/bulletin/${article.id}?lang=ko-kr&code=arknights_endfield_official`, cms));
        if (!isRecord(result) || result.code !== 0 || !isRecord(result.data) || typeof result.data.data !== 'string') throw new Error('Unexpected Endfield CMS article');
        return { ...article, content: result.data.data,
          ...(isImageUrl(result.data.cover) ? { imageUrl: result.data.cover } : {}) };
      } catch (error) {
        console.error('[endfield] CMS article unavailable, trying HTML', error);
        return { ...article, content: await fetchHtml(new URL(article.id, base)) };
      }
    }));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') articles.push(result.value);
      else { failed++; console.error('[endfield] article unavailable', result.reason);
        const article = batch[index];
        if (article) issues.push({ id: `endfield:fetch:${article.id}`, game: 'endfield', title: article.title,
          reason: '공지 본문 수집 실패. 원문 확인 또는 재수집이 필요합니다.', sourceUrl: new URL(article.id, base).href, excerpt: '' });
      }
    }
  }
  if (list.length && failed === list.length) throw new Error('Endfield articles unavailable');
  const boundaries = articles.flatMap((article) => { const boundary = parseEndfieldBoundary(article); return boundary ? [boundary] : []; });
  for (const article of articles.filter((item) => /버전 개발자/.test(item.title))) {
    const release = /신규 버전\s*「([^」]+)」가\s*(\d{1,2})월\s*(\d{1,2})일\s*정식 개방/.exec(stripHtml(article.content));
    if (release) {
      const published = new Date(article.publishedAt ?? Date.now());
      const month = Number(release[2]);
      const year = published.getUTCFullYear() + (month < published.getUTCMonth() + 1 ? 1 : 0);
      const day = `${year}/${String(month).padStart(2, '0')}/${String(release[3]).padStart(2, '0')}`;
      const dateBoundary = new Date(`${day.replaceAll('/', '-')}T00:00:00+09:00`);
      const preceding = [...boundaries].filter((boundary) => boundary.version !== release[1]
        && Date.parse(boundary.startAt) < dateBoundary.getTime()).sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
      if (!preceding || preceding.endAt || !Number.isFinite(dateBoundary.getTime())
        || boundaries.some((boundary) => boundary.startAt > preceding.startAt)) continue;
      if (preceding && !preceding.endAt && Number.isFinite(dateBoundary.getTime())) {
        preceding.announcedEndDate = day;
        preceding.endSourceUrl = new URL(article.id, base).href;
      }
      issues.push({ id: `endfield:release:${article.id}`, game: 'endfield', title: article.title,
      reason: `다음 버전 「${release[1]}」 ${release[2]}월 ${release[3]}일 개방 공지 확인. 날짜 경계로 반영했으며 정확한 점검 시작 시각 확인이 필요합니다.`,
      ...(preceding ? { eventId: `endfield:version:${preceding.version}` } : {}),
      sourceUrl: new URL(article.id, base).href, excerpt: stripHtml(article.content).slice(0, 6000) });
    }
  }
  let versionEvents = buildVersionEvents('endfield', boundaries);
  if (structuredVersion) {
    try { versionEvents = supplementStructuredVersion(versionEvents, structuredVersion.raw, structuredVersion.sourceUrl, 'endfield'); }
    catch (error) { console.error('[endfield] original version validation failed', error); }
  }
  for (const boundary of boundaries) {
    const version = versionEvents.find((event) => event.id === `endfield:version:${boundary.version}`);
    if (version && version.versionEndBasis !== 'default-42-days' && version.versionEndBasis !== 'announced-date') {
      boundary.endAt = version.endAt;
      boundary.endSourceUrl = version.versionEndSourceUrl ?? version.sourceUrl;
    }
  }
  const parsed = articles.map((article) => {
    const result = parseEndfieldEvents(article, boundaries);
    if (result.skipped) issues.push({ id: `endfield:period:${article.id}`, game: 'endfield', title: article.title,
      reason: `이 공지에서 ${result.skipped}개 기간을 달력에 표시하지 못했습니다. ${result.unresolvedPeriods.join(' · ')}`.slice(0, 3000),
      sourceUrl: new URL(article.id, base).href, excerpt: stripHtml(article.content).slice(0, 6000) });
    return result;
  });
  const all = [...versionEvents, ...parsed.flatMap((item) => item.events)];
  let events = all;
  if (structuredVersion) {
    try {
      const supplementary = parseStructuredActivities(structuredVersion.raw, structuredVersion.sourceUrl, 'endfield', await loadKoreanNames('endfield'));
      events = [...supplementary.events, ...events];
      issues.push(...supplementary.issues);
    } catch (error) { console.error('[endfield] original activity validation failed', error); }
  }
  const skipped = failed + parsed.reduce((sum, item) => sum + item.skipped, 0);
  const remainingIssues = issues.filter((issue) => !issue.id.startsWith('endfield:release:')
    || !events.some((event) => event.id === issue.eventId && event.periodBasis === 'community-data'));
  return { events, skipped, issues: remainingIssues, partial: true,
    message: `버전·이벤트는 원본 구조화 API 대조 · 누락은 공식 한국어 ${cmsAvailable ? '뉴스 API(최근 100일 전체)' : '뉴스 페이지'}에서 보완. ${skipped}개 기간은 상대 종료·상시/조건부·이미지 등으로 표시 제외. 엔드콘텐츠는 대상 제외.` };
};

export const fetchGame = (game: GameId) => game === 'wuwa' ? fetchWuwa() : game === 'endfield' ? fetchEndfield() : fetchHoyo(game);

