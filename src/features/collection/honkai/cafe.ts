import { isImageUrl, isRecord } from '../../../../shared/calendar';
import type { CollectionIssue } from '../../../../shared/admin';
import { stripHtml } from '../parsers';
import type { HonkaiArticle } from './parsers';

const CAFE_ID = 29145934;
const OFFICIAL_MEMBER_KEY = 'TIDjSPSPnZZGfInzDc0UWhuSgywYqDQue253NTP6fZM';
const MENUS = [14, 15];
export const HONKAI_CAFE_URL = 'https://cafe.naver.com/honkai3rd';
interface CafeItem { id: number; menuId: number; title: string; createdAt: number }

export const parseHonkaiCafeList = (raw: unknown, menuId: number) => {
  if (!isRecord(raw) || !isRecord(raw.message) || raw.message.status !== '200' || !isRecord(raw.message.result)) {
    throw new Error('Unexpected Honkai cafe list schema');
  }
  const result = raw.message.result;
  if (result.cafeId !== CAFE_ID || !Array.isArray(result.articleList) || typeof result.hasNext !== 'boolean') {
    throw new Error('Unexpected Honkai cafe list');
  }
  const items: CafeItem[] = result.articleList.filter(isRecord).flatMap((item) => {
    if (item.cafeId !== CAFE_ID || item.menuId !== menuId || item.memberKey !== OFFICIAL_MEMBER_KEY
      || typeof item.articleId !== 'number' || !Number.isSafeInteger(item.articleId) || item.articleId <= 0
      || typeof item.subject !== 'string' || typeof item.writeDateTimestamp !== 'number'
      || !Number.isFinite(item.writeDateTimestamp)) return [];
    return [{ id: item.articleId, menuId, title: stripHtml(item.subject), createdAt: item.writeDateTimestamp / 1000 }];
  });
  return { items, hasNext: result.hasNext };
};

export const parseHonkaiCafeArticle = (raw: unknown, item: CafeItem): HonkaiArticle => {
  if (!isRecord(raw) || !isRecord(raw.result) || raw.result.cafeId !== CAFE_ID || raw.result.articleId !== item.id
    || !isRecord(raw.result.article)) throw new Error('Unexpected Honkai cafe article schema');
  const article = raw.result.article;
  if (article.id !== item.id || !isRecord(article.menu) || article.menu.id !== item.menuId
    || !isRecord(article.writer) || article.writer.memberKey !== OFFICIAL_MEMBER_KEY || typeof article.contentHtml !== 'string') {
    throw new Error('Official Honkai cafe article unavailable');
  }
  const images = [...article.contentHtml.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]).filter(isImageUrl);
  return { id: `cafe-${item.id}`, title: item.title, createdAt: item.createdAt,
    description: stripHtml(article.contentHtml).replace(/[\u200b-\u200d\ufeff]/g, ''), url: `${HONKAI_CAFE_URL}/${item.id}`,
    ...(images[0] ? { imageUrl: images[0] } : {}) };
};

const readCafeJson = async (url: URL) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', Referer: HONKAI_CAFE_URL } });
  if (!response.ok) throw new Error(`Honkai cafe HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
};

export const fetchHonkaiCafe = async (now = Date.now()) => {
  const issues: CollectionIssue[] = [];
  const items: CafeItem[] = [];
  let available = false;
  for (const menu of MENUS) {
    try {
      for (let page = 1; page <= 4; page++) {
        const url = new URL('https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json');
        url.search = new URLSearchParams({ 'search.clubid': String(CAFE_ID), 'search.menuid': String(menu),
          'search.page': String(page), 'search.perPage': '50' }).toString();
        const result = parseHonkaiCafeList(await readCafeJson(url), menu);
        available = true;
        items.push(...result.items.filter((item) => item.createdAt * 1000 > now - 100 * 86400000));
        if (!result.hasNext) break;
        if (page === 4) issues.push({ id: `honkai:cafe:pagination:${menu}`, game: 'honkai', title: '공식 카페 수집 범위 확인',
          reason: '게시판 수집 한도 4페이지 이후 공지 확인 필요', sourceUrl: HONKAI_CAFE_URL, excerpt: '' });
      }
    } catch {
      issues.push({ id: `honkai:cafe:fetch:${menu}`, game: 'honkai', title: '공식 카페 게시판 수집 실패',
        reason: '공개 공지 목록 수집 실패. 재수집 필요', sourceUrl: HONKAI_CAFE_URL, excerpt: '' });
    }
  }
  const articles: HonkaiArticle[] = [];
  const relevant = [...new Map(items.filter((item) => /이벤트|보급|버전|코스튬|신규.*캐릭터/.test(item.title)
    && !/확률 표기|오류|PV|예고 영상|당첨|호요랜드|공모/.test(item.title)).map((item) => [item.id, item])).values()];
  for (let offset = 0; offset < relevant.length; offset += 4) {
    const batch = relevant.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map(async (item) => parseHonkaiCafeArticle(await readCafeJson(
      new URL(`https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${CAFE_ID}/articles/${item.id}?useCafeId=true`)), item)));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') articles.push(result.value);
      else issues.push({ id: `honkai:cafe:post:${batch[index]!.id}`, game: 'honkai', title: batch[index]!.title,
        reason: '공식 카페 본문 수집 실패. 원문 확인 필요', sourceUrl: `${HONKAI_CAFE_URL}/${batch[index]!.id}`, excerpt: '' });
    }
  }
  return { available, articles, issues };
};
