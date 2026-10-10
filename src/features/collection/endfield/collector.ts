import { isImageUrl, isRecord } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { buildVersionEvents, stripHtml, type CollectionArticle } from '../parsers';
import { parseEndfieldBoundary, parseEndfieldNewsList } from './localized';
import { loadKoreanNames } from '../names';
import { fetchJson, fetchHtml } from '../http';
import { fetchStructuredVersion, supplementStructuredVersion, parseStructuredActivities } from '../sra';
import { learnEndfieldChallengeNames } from './structured';
import { parseEndfieldEvents } from './custom';
import { supplementEndfieldReleaseDates } from './custom/version-boundaries';

export const fetchEndfield = async () => {
  const structuredVersion = await fetchStructuredVersion('endfield');
  const base = process.env.ENDFIELD_NEWS_BASE ?? 'https://endfield.gryphline.com/ko-kr/news/';
  const cms = process.env.ENDFIELD_CMS_BASE ?? 'https://web-news.gryphline.com/';
  let cmsAvailable = true;
  let news: CollectionArticle[] = [];
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
  const articles: CollectionArticle[] = [];
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
  supplementEndfieldReleaseDates(articles, boundaries, base, issues);
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
  const characterBanners = articles.flatMap((article) => parseEndfieldEvents(article, boundaries).events)
    .filter((event) => event.kind === 'banner' && /특별 허가 헤드헌팅/.test(event.title));
  const parsed = articles.map((article) => {
    const result = parseEndfieldEvents(article, boundaries, characterBanners);
    for (const event of result.events.filter((item) => item.periodBasis === 'community-cycle')) {
      issues.push({ id: `endfield:weapon-cycle:${event.id}`, game: 'endfield', eventId: event.id, title: event.title,
        reason: '캐릭터 픽업 3회 중 미공개 회차는 마지막 확인 픽업 기간으로 추정했습니다. 후속 공지 수집 시 종료일을 갱신합니다.',
        sourceUrl: event.sourceUrl, excerpt: event.description });
    }
    if (result.skipped) issues.push({ id: `endfield:period:${article.id}`, game: 'endfield', title: article.title,
      reason: `이 공지에서 ${result.skipped}개 기간을 달력에 표시하지 못했습니다. ${result.unresolvedPeriods.join(' · ')}`.slice(0, 3000),
      sourceUrl: new URL(article.id, base).href, excerpt: stripHtml(article.content).slice(0, 6000) });
    return result;
  });
  const all = [...versionEvents, ...parsed.flatMap((item) => item.events)];
  let events = all;
  if (structuredVersion) {
    try {
      const names = learnEndfieldChallengeNames(structuredVersion.raw, events, await loadKoreanNames('endfield'));
      const supplementary = parseStructuredActivities(structuredVersion.raw, structuredVersion.sourceUrl, 'endfield', names);
      events = [...supplementary.events, ...events];
      issues.push(...supplementary.issues);
    } catch (error) { console.error('[endfield] original activity validation failed', error); }
  }
  const skipped = failed + parsed.reduce((sum, item) => sum + item.skipped, 0);
  const remainingIssues = issues.filter((issue) => !issue.id.startsWith('endfield:release:')
    || !events.some((event) => event.id === issue.eventId && event.periodBasis === 'community-data'));
  return { events, skipped, issues: remainingIssues, partial: true,
    message: `버전·이벤트는 원본 구조화 API 대조 · 누락은 공식 한국어 ${cmsAvailable ? '뉴스 API(최근 100일 전체)' : '뉴스 페이지'}에서 보완. ${skipped}개 기간은 상대 종료·상시/조건부·이미지 등으로 표시 제외. 전쟁의 메아리는 공식 시즌 기간 수집.` };
};
