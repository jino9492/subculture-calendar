import type { CollectionIssue } from '../../../../../shared/admin';
import { stripHtml, type CollectionArticle, type VersionBoundary } from '../../parsers';

export const supplementEndfieldReleaseDates = (articles: CollectionArticle[], boundaries: VersionBoundary[], base: string, issues: CollectionIssue[]) => {
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
};
