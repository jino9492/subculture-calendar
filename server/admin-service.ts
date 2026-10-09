import { type CollectedCalendar } from '../shared/calendar';
import { type CollectionIssue } from '../shared/admin';
import { readAdminState, normalizeAdminState } from './admin-store';

const SOURCE_URLS = {
  genshin: 'https://api.ennead.cc/mihoyo/genshin/calendar?lang=ko-kr',
  starrail: 'https://api.ennead.cc/mihoyo/starrail/calendar?lang=ko-kr',
  zenless: 'https://api.ennead.cc/mihoyo/zenless/calendar?lang=ko-kr',
  wuwa: 'https://wutheringwaves.kurogames.com/kr/main/news',
  endfield: 'https://endfield.gryphline.com/ko-kr/news/',
};
export const getAdminData = async (calendar: CollectedCalendar, diagnostics: CollectionIssue[]) => {
  const issues = [...diagnostics];
  for (const event of calendar.events) {
    if (!event.sourceLanguage.startsWith('ko') && event.displayLanguage !== 'ko-kr'
      && !issues.some((issue) => issue.eventId === event.id && issue.id.startsWith('translation:'))) issues.push({ id: `language:${event.id}`, game: event.game,
      title: event.title, reason: '한국어 이름을 확인하지 못한 외국어 데이터입니다. 제목 보정 후 표시 언어를 한국어로 선택하세요.',
      sourceUrl: event.sourceUrl, excerpt: event.description, eventId: event.id });
    if (event.periodBasis) issues.push({ id: `period:${event.id}`, game: event.game, title: event.title,
      reason: event.periodBasis === 'community-cycle' ? '공개 Asia 반복 규칙으로 계산한 기간입니다. 게임 내 주기 변경 시 확인이 필요합니다.'
        : '공개 커뮤니티 Asia 데이터에 명시된 기간입니다. 공식 공지와 게임 내 기간을 우선 대조하세요.',
      sourceUrl: event.sourceUrl, excerpt: event.description, eventId: event.id });
    if (event.kind === 'version' && (event.versionEndBasis === 'default-42-days' || Date.parse(event.endAt) - Date.parse(event.startAt) <= 1000)) issues.push({
      id: `version:${event.id}`, game: event.game, title: event.title, reason: '종료 시각 수집 누락 · 버전 시작부터 42일 기본값 적용. 정확한 기간·단축 여부 확인이 필요합니다.',
      sourceUrl: event.sourceUrl, excerpt: event.description, eventId: event.id });
  }
  for (const source of calendar.sources.filter((item) => item.state !== 'ok')) issues.push({
    id: `source:${source.game}:${source.state}`, game: source.game, title: '수집 상태 · 범위 확인',
    reason: source.message, sourceUrl: SOURCE_URLS[source.game],
    excerpt: `제외 항목 ${source.skipped}개. 개별 항목 처리 후에도 원본 수집 상태는 유지됩니다. 수집 범위 제한은 확인 메모로 관리하세요.`,
  });
  return { ...calendar, collectedEvents: calendar.events, issues: [...new Map(issues.map((item) => [item.id, item])).values()],
    management: normalizeAdminState(await readAdminState(), calendar.events) };
};
