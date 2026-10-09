import type { CalendarEvent } from '../../../shared/calendar';
import type { CollectionIssue } from '../../../shared/admin';
import { isPendingScheduleName } from './names';

const HOUR = 3600000;
const normalize = (title: string) => title.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

export const scheduleTitleKey = (event: CalendarEvent): string => {
  if (isPendingScheduleName(event) || /한국어 이름 확인/.test(event.title)) return '';
  let title = event.title.replace(/^이벤트 예고\s*\|\s*/, '').trim();
  // 픽업 종류와 회차는 보존하고 공지 제목의 개방·안내 문구만 비교에서 제외
  if (event.kind === 'banner' && /^(?:「[^」]+」|\[[^\]]+\]).*(?:기원|워프|채널|튜닝|헤드헌팅|신청)(?:\s*#\s*\d+)?\s+(?:개방(?:\s*안내)?|안내|오픈)[.!\s]*$/.test(title)) {
    title = title.replace(/\s+(?:개방(?:\s*안내)?|안내|오픈)[.!\s]*$/, '');
  }
  // 인용구 뒤의 정형 안내 문구만 제거하고 하위 행사 이름은 보존
  const quoted = /^(?:「([^」]+)」|\[([^\]]+)\])\s*((?:기간 한정\s*)?(?:멀티플레이\s*)?(?:전투\s*)?(?:미니\s*)?이벤트(?:\s*[:：].*|가 곧 시작됩니다!|\s*안내)?)[.!\s]*$/.exec(title);
  const subject = quoted?.[1] ?? quoted?.[2];
  const phase = subject ? /\s+·\s+([^·]+)$/.exec(quoted?.[3] ?? '')?.[1] : undefined;
  return normalize(subject ? `${subject}${phase ? ` · ${phase}` : ''}` : title);
};

const structured = (event: CalendarEvent) => event.collectionMethod === 'structured'
  || event.collectionMethod === undefined && Boolean(event.localizationKey);
const priority = (event: CalendarEvent) => structured(event) ? event.sourceLanguage.startsWith('ko') ? 0 : 1 : 2;
const key = (event: CalendarEvent) => event.identityKey ?? event.localizationKey;
const family = (event: CalendarEvent) => key(event)?.split(':').slice(0, 3).join(':');
const sourceIds = (event: CalendarEvent) => [event.id, ...(event.collectionSources ?? []).map((source) => source.id)];

const periodMatches = (left: Pick<CalendarEvent, 'startAt' | 'endAt' | 'sourceUrl'>,
  right: Pick<CalendarEvent, 'startAt' | 'endAt' | 'sourceUrl'>, confirmed: boolean) => {
  const a = Date.parse(left.startAt), b = Date.parse(right.startAt);
  const c = Date.parse(left.endAt), d = Date.parse(right.endAt);
  const overlap = Math.min(c, d) - Math.max(a, b);
  if (overlap <= 0) return false;
  const duration = Math.min(c - a, d - b);
  if (overlap / duration < .8 || overlap / Math.max(c - a, d - b) < .75) return false;
  const startDelta = Math.abs(a - b), endDelta = Math.abs(c - d);
  if (startDelta <= 90 * 1000 && endDelta <= 90 * 1000) return true;
  if (confirmed && startDelta <= 24 * HOUR && endDelta <= 24 * HOUR) return true;
  // 출처별 서버 시차는 양 끝 경계의 같은 이동으로 대조
  if (left.sourceUrl !== right.sourceUrl && startDelta <= 24 * HOUR && endDelta <= 24 * HOUR
    && Math.abs((a - b) - (c - d)) <= 2 * HOUR) return true;
  return left.sourceUrl !== right.sourceUrl && endDelta <= 90 * 1000
    && startDelta <= Math.min(72 * HOUR, duration * .2);
};

export const isSameScheduleCycle = (left: CalendarEvent, right: CalendarEvent, confirmed: boolean) =>
  [left, ...(left.collectionSources ?? [])].every((a) =>
    [right, ...(right.collectionSources ?? [])].every((b) => periodMatches(a, b, confirmed)));

const titleMatches = (left: CalendarEvent, right: CalendarEvent) => {
  const title = scheduleTitleKey(left);
  if (title && title === scheduleTitleKey(right)) return true;
  const notice = structured(left) ? right : left;
  const native = structured(left) ? left : right;
  if (!structured(native) || structured(notice) || native.kind !== 'event') return false;
  const quoted = /^(?:이벤트 예고\s*\|\s*)?(?:「([^」]+)」|\[([^\]]+)\])(.+)$/.exec(notice.title);
  // 구조화 제목 전체와 인용된 주제가 같을 때만 부가 공지 문구로 연결
  return Boolean(quoted && !/\s+·\s+/.test(quoted[3] ?? '') && normalize(quoted[1] ?? quoted[2] ?? '') === scheduleTitleKey(native));
};

const matches = (left: CalendarEvent, right: CalendarEvent) => {
  if (left.game !== right.game || left.kind !== right.kind) return false;
  if (sourceIds(left).some((id) => sourceIds(right).includes(id))) return isSameScheduleCycle(left, right, true);
  const confirmed = Boolean(key(left) && key(left) === key(right));
  if (!confirmed && key(left) && key(right) && family(left) === family(right) && structured(left) && structured(right)) return false;
  if (!confirmed && !titleMatches(left, right)) return false;
  return isSameScheduleCycle(left, right, confirmed);
};

const combine = (members: CalendarEvent[]): CalendarEvent => {
  const ordered = [...members].sort(compare);
  const preferred = ordered[0];
  if (!preferred) throw new Error('Empty schedule group');
  const name = ordered.find((event) => !isPendingScheduleName(event)) ?? preferred;
  const sources = [...new Map(ordered.flatMap((event) => event.collectionSources ?? [{ id: event.id, title: event.title,
    startAt: event.startAt, endAt: event.endAt, sourceUrl: event.sourceUrl }]).map((source) => [source.id, source])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
  // 출처별 대표 그림의 다른 URL을 합치지 않고 한 출처의 이미지 목록만 선택
  const images = [...new Set(ordered.find((event) => event.imageUrls?.length)?.imageUrls ?? [])].slice(0, 12);
  return { ...preferred, title: name.title,
    ...(!isPendingScheduleName(name) && (name.displayLanguage === 'ko-kr' || name.sourceLanguage.startsWith('ko')) ? { displayLanguage: 'ko-kr' as const } : {}),
    ...(images.length ? { imageUrls: images } : {}), ...(sources.length > 1 ? { collectionSources: sources } : {}) };
};

const compare = (a: CalendarEvent, b: CalendarEvent) => priority(a) - priority(b)
  || Number(isPendingScheduleName(a)) - Number(isPendingScheduleName(b)) || a.title.length - b.title.length || a.id.localeCompare(b.id)
  || JSON.stringify(a).localeCompare(JSON.stringify(b));

export const reconcileSchedules = (candidates: CalendarEvent[]) => {
  const groups: CalendarEvent[][] = [];
  const issues: CollectionIssue[] = [];
  const named = candidates.map((event) => {
    if (structured(event) || event.kind !== 'event') return event;
    const phase = /^(?:「([^」]+)」|\[([^\]]+)\]).*\s+·\s+([^·]+)$/.exec(event.title);
    if (!phase) return event;
    const parents = candidates.filter((parent) => structured(parent) && parent.game === event.game && parent.kind === event.kind
      && scheduleTitleKey(parent) === normalize(phase[1] ?? phase[2] ?? '')
      && Date.parse(parent.startAt) <= Date.parse(event.startAt) + 90000 && Date.parse(parent.endAt) >= Date.parse(event.endAt) - 90000);
    const names = [...new Set(parents.map((parent) => parent.title))];
    return names.length === 1 ? { ...event, title: `${names[0]} · ${phase[3]}`,
      collectionSources: event.collectionSources ?? [{ id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, sourceUrl: event.sourceUrl }] } : event;
  });
  const linked = named.map((event) => {
    if (structured(event) || event.identityKey) return event;
    const identities = [...new Set(named.filter((native) => structured(native) && native.game === event.game && native.kind === event.kind
      && titleMatches(native, event) && isSameScheduleCycle(native, event, false)).map(key).filter(Boolean))];
    return identities.length === 1 ? { ...event, identityKey: identities[0] } : event;
  });
  for (const event of linked.sort(compare)) {
    // 모든 구성원과 일치하는 그룹만 허용하여 중간 후보를 통한 연쇄 오병합 방지
    const compatible = groups.filter((group) => group.every((member) => matches(member, event)));
    const target = compatible.length === 1 ? compatible[0] : undefined;
    if (target) target.push(event);
    else {
      groups.push([event]);
      if (compatible.length > 1) issues.push({ id: `reconciliation:${event.id}`, game: event.game, title: event.title,
        eventId: event.id, sourceUrl: event.sourceUrl, reason: '같은 일정으로 연결할 후보가 여러 개여서 자동 병합을 보류했습니다.',
        excerpt: compatible.flatMap((group) => group.map((member) => `${member.id}: ${member.title} (${member.startAt} ~ ${member.endAt})`)).join('\n').slice(0, 6000) });
    }
  }
  const events = groups.map(combine);
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const left = events[i], right = events[j];
    if (!left || !right || left.game !== right.game || left.kind !== right.kind || !titleMatches(left, right)) continue;
    if (structured(left) && structured(right) && key(left) && key(right) && key(left) !== key(right)) continue;
    const overlap = Math.min(Date.parse(left.endAt), Date.parse(right.endAt)) - Math.max(Date.parse(left.startAt), Date.parse(right.startAt));
    const duration = Math.max(Date.parse(left.endAt) - Date.parse(left.startAt), Date.parse(right.endAt) - Date.parse(right.startAt));
    if (overlap / duration < .75 || isSameScheduleCycle(left, right, false)) continue;
    issues.push({ id: `reconciliation:period:${[left.id, right.id].sort().join(':')}`, game: left.game, title: left.title,
      eventId: left.id, sourceUrl: left.sourceUrl, reason: '동일 콘텐츠 후보의 출처별 기간이 달라 자동 병합을 보류했습니다.',
      excerpt: `${left.title}: ${left.startAt} ~ ${left.endAt} (${left.sourceUrl})\n${right.title}: ${right.startAt} ~ ${right.endAt} (${right.sourceUrl})` });
  }
  const counts = new Map<string, number>();
  events.forEach((event) => counts.set(event.id, (counts.get(event.id) ?? 0) + 1));
  return { events: events.map((event) => {
    if (counts.get(event.id) === 1) return event;
    const id = `${event.id}:cycle:${Date.parse(event.startAt)}`;
    issues.push({ id: `reconciliation:${id}:reused-id`, eventId: id, game: event.game, title: event.title, sourceUrl: event.sourceUrl,
      reason: '원본 ID가 서로 다른 기간에 재사용되어 주기별 일정 ID로 분리했습니다.', excerpt: `${event.startAt} ~ ${event.endAt}` });
    return { ...event, id, collectionSources: event.collectionSources ?? [{ id: event.id, title: event.title,
      startAt: event.startAt, endAt: event.endAt, sourceUrl: event.sourceUrl }] };
  }), issues };
};

export const resolveScheduleId = (events: CalendarEvent[], id: string) => {
  const matches = events.filter((event) => sourceIds(event).includes(id));
  return matches.length === 1 ? matches[0]?.id ?? id : id;
};
