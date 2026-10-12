import { isRecord } from '../../../../shared/calendar';
import { parseHonkaiPost, type HonkaiArticle } from './parsers';

export const fetchLinkedHonkaiArticles = async (articles: HonkaiArticle[]) => {
  const urls = [...new Set(articles.flatMap((article) => article.description.match(/https:\/\/hoyo\.link\/[A-Za-z0-9]+/g) ?? []))].slice(0, 20);
  const linked: HonkaiArticle[] = [];
  for (let offset = 0; offset < urls.length; offset += 4) {
    const results = await Promise.allSettled(urls.slice(offset, offset + 4).map(async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const destination = new URL(response.url);
      await response.body?.cancel();
      if (destination.hostname !== 'www.hoyolab.com') return null;
      const match = /^\/article(_pre)?\/(\d+)$/.exec(destination.pathname);
      if (!match) return null;
      let id = match[2]!;
      const headers = { Accept: 'application/json', 'x-rpc-language': 'ko-kr' };
      if (match[1]) {
        const mapping: unknown = await (await fetch(`https://bbs-api-os.hoyolab.com/community/post/wapi/getPostID?id=${id}`,
          { signal: AbortSignal.timeout(15000), headers })).json();
        if (!isRecord(mapping) || mapping.retcode !== 0 || !isRecord(mapping.data) || typeof mapping.data.post_id !== 'string'
          || !/^\d+$/.test(mapping.data.post_id)) throw new Error('Honkai linked post unavailable');
        id = mapping.data.post_id;
      }
      const raw: unknown = await (await fetch(`https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${id}`,
        { signal: AbortSignal.timeout(15000), headers })).json();
      if (!isRecord(raw) || !isRecord(raw.data) || !isRecord(raw.data.post) || !isRecord(raw.data.post.post)) throw new Error('Unexpected linked Honkai post');
      const post = raw.data.post.post;
      if (typeof post.subject !== 'string' || typeof post.created_at !== 'number') throw new Error('Invalid linked Honkai post');
      return parseHonkaiPost(raw, { id, title: post.subject, createdAt: post.created_at,
        description: '', url: `https://www.hoyolab.com/article/${id}` });
    }));
    for (const result of results) if (result.status === 'fulfilled' && result.value) linked.push(result.value);
  }
  return [...new Map(linked.map((article) => [article.id, article])).values()];
};
