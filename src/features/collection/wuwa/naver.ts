import { isRecord } from '../../../../shared/calendar';
import type { CollectionArticle } from '../parsers';

export const parseWuwaNaverFeed = (value: unknown): CollectionArticle | null => {
  if (!isRecord(value) || !isRecord(value.feed) || !isRecord(value.user) || value.user.userRoleCode !== 'game_manager') return null;
  const feed = value.feed;
  if (feed.loungeId !== 'WutheringWaves' || typeof feed.feedId !== 'number' || !Number.isSafeInteger(feed.feedId)
    || typeof feed.title !== 'string' || typeof feed.contents !== 'string' || typeof feed.createdDate !== 'string'
    || !/^\d{14}$/.test(feed.createdDate)) return null;
  let content = feed.contents;
  if (content.trim().startsWith('{')) {
    const raw: unknown = JSON.parse(content);
    if (!isRecord(raw) || !isRecord(raw.document) || !Array.isArray(raw.document.components)) throw new Error('Unexpected Naver document');
    content = raw.document.components.filter(isRecord).filter((component) => component['@ctype'] === 'text')
      .flatMap((component) => Array.isArray(component.value) ? component.value.filter(isRecord) : [])
      .map((paragraph) => Array.isArray(paragraph.nodes) ? paragraph.nodes.filter(isRecord)
        .filter((node) => node['@ctype'] === 'textNode' && typeof node.value === 'string').map((node) => node.value).join('') : '')
      .join('\n');
  }
  const date = feed.createdDate;
  return { id: `naver-${feed.feedId}`, title: feed.title, content: content.replace(/[\u200b-\u200d\ufeff]/g, ''),
    publishedAt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(8, 10)}:${date.slice(10, 12)}:${date.slice(12, 14)}+09:00`,
    sourceUrl: `https://game.naver.com/lounge/WutheringWaves/board/detail/${feed.feedId}` };
};
