import { isRecord, type CalendarEvent, type GameId } from '../../../../shared/calendar';
import { parseLocalDate, stripHtml, type VersionBoundary } from './parsers';
import type { CollectionIssue } from '../../../../shared/admin';
import { reconcileSchedules, isSameScheduleCycle } from '../reconciliation';
import { parseHoyoTimeRange, ZONED_TIME_PATTERN } from '../time-evidence';

type HoyoGame = Exclude<GameId, 'wuwa' | 'endfield'>;
export interface Announcement { id: string; title: string; description: string; url: string }

export const hoyoAnnouncementUrl = (game: HoyoGame, language: 'ko-kr' | 'en-us' = 'ko-kr') => {
  const settings = {
    genshin: { base: 'https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/', game: 'hk4e', region: 'os_asia', level: '8' },
    starrail: { base: 'https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/', game: 'hkrpg', region: 'prod_official_asia', level: '70' },
    zenless: { base: 'https://sg-announcement-static.hoyoverse.com/common/nap_global/', game: 'nap', region: 'prod_gf_jp', level: '60' },
  }[game];
  const url = new URL('announcement/api/getAnnContent', settings.base);
  url.search = new URLSearchParams({ game: settings.game, game_biz: `${settings.game}_global`, bundle_id: `${settings.game}_global`,
    platform: 'pc', region: settings.region, uid: '0', level: settings.level, lang: language, channel_id: '1' }).toString();
  return url;
};

export const parseHoyoAnnouncements = (raw: unknown, sourceUrl: string, language: 'ko-kr' | 'en-us' = 'ko-kr'): Announcement[] => {
  if (!isRecord(raw) || raw.retcode !== 0 || !isRecord(raw.data) || !Array.isArray(raw.data.list)) throw new Error('Unexpected announcement schema');
  return raw.data.list.filter(isRecord).flatMap((item) => {
    if (typeof item.title !== 'string' || typeof item.content !== 'string' || (typeof item.ann_id !== 'number' && typeof item.ann_id !== 'string')
      || (item.lang !== undefined && item.lang !== language)) return [];
    const decoded = item.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // 아시아 서버의 t_lc·UTC+8 t_gl 태그를 한국 시간으로 변환
    const normalized = decoded.replace(/<t\b[^>]*class=["']t_(?:lc|gl)["'][^>]*>([^<]+)<\/t>/g, (_, date: string) => {
      const utc = parseLocalDate(date, 8);
      if (!utc) return '';
      const length = /:\d{2}:\d{2}$/.test(date.trim()) ? 19 : 16;
      return `${new Date(Date.parse(utc) + 9 * 3600000).toISOString().slice(0, length).replace('T', ' ')} (KST)`;
    });
    return [{ id: String(item.ann_id), title: stripHtml(item.title), description: stripHtml(normalized), url: sourceUrl }];
  });
};

const identity = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const matchesTitle = (left: string, right: string) => {
  const a = identity(left); const b = identity(right);
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
};

export const supplementHoyoCalendar = (game: HoyoGame, parsed: { events: CalendarEvent[]; issues: CollectionIssue[]; skipped: number },
  announcements: Announcement[], boundaries: VersionBoundary[]) => {
  const events = parsed.events.map((event) => ({ ...event }));
  let issues = [...parsed.issues];
  let resolved = 0;
  for (const article of announcements) {
    if (/웹\s*이벤트|댓글 이벤트|설문/.test(article.title)) continue;
    const lines = article.description.split('\n').map((line) => line.trim()).filter(Boolean);
    const headers = lines.flatMap((line, index) => /^[〓✦■·\s]*(?:이벤트|기원|워프|채널|개방)\s*기간(?:[〓✦\s:：]+|$)/.test(line)
      && !/^이벤트\s*기간\s*(?:동안|중)/.test(line) ? [index] : []);
    if (!headers.length) {
      if (/이벤트|출석\s*체크|기원|워프|채널/.test(article.title)) issues.push({ id: `${game}:announcement:${article.id}:format`, game,
        title: article.title, reason: '공지의 일정 기간 형식을 읽지 못했습니다. 이미지 또는 새로운 기간 표기 확인 필요', sourceUrl: article.url, excerpt: article.description.slice(0, 6000) });
      continue;
    }
    for (const [position, header] of headers.entries()) {
      const sectionLines = lines.slice(header, headers[position + 1] ?? lines.length);
      const next = sectionLines.findIndex((line, index) => index > 0 && (/^■\s*\S/.test(line)
        || /^(?:[〓✦■·\s]*)(?:이벤트\s*|참여\s*)?(?:조건|안내|설명|소개|규칙|보상)/.test(line)));
      const section = (next >= 0 ? sectionLines.slice(0, next) : sectionLines).join('\n');
      const ranges = [...section.matchAll(new RegExp(`(${ZONED_TIME_PATTERN})\\s*[-–~]\\s*(${ZONED_TIME_PATTERN})`, 'g'))];
      const preceding = lines.slice((headers[position - 1] ?? -1) + 1, header);
      const heading = [...preceding].reverse().find((line) => /^■\s*\S/.test(line))?.replace(/^■\s*/, '')
        ?? [...preceding].reverse().find((line) => /「[^」]+」|\[[^\]]+\]/.test(line)
        && /이벤트|기원|워프|채널|출석\s*체크/.test(line) && !/설명|조건|보상|참여|획득|확률/.test(line));
      const articleTitle = headers.length > 1 || /버전.*업데이트/.test(article.title) ? heading : article.title;
      const periods = ranges.length ? ranges.map((range) => {
        const prefix = section.slice(0, range.index).split('\n').at(-1)?.replace(/[〓✦■]/g, '').trim() ?? '';
        const label = /(.+?)\s*(?:기간|시간)\s*[:：]\s*$/.exec(prefix)?.[1]?.trim();
        const evidence = parseHoyoTimeRange(range[0], boundaries, article.url);
        return { startAt: evidence?.start.at, endAt: evidence?.end.at, evidence,
          label: label && !/^(?:이벤트|콘텐츠|개방|콘텐츠 개방)$/.test(label) ? label : undefined };
      })
        : (() => {
          const evidence = parseHoyoTimeRange(section, boundaries, article.url);
          return [{ startAt: evidence?.start.at, endAt: evidence?.end.at, evidence, label: undefined }];
        })();
      for (const [periodIndex, { startAt, endAt, label, evidence }] of periods.entries()) {
        if (!startAt || !endAt || endAt <= startAt || !articleTitle) {
          issues.push({ id: `${game}:announcement:${article.id}:period:${header}`, game, title: articleTitle ?? article.title,
            reason: '공지의 일정 제목 또는 시작·종료 기간 확인 필요', sourceUrl: article.url, excerpt: section.slice(0, 6000) });
          continue;
      }
        const kind = /^(?:[〓✦■·\s]*)(?:기원|워프|채널)\s*기간/.test(lines[header] ?? '') ? 'banner' : 'event';
        const matchingIssues = issues.filter((issue) => matchesTitle(issue.title, articleTitle));
        const nativeMatches = parsed.events.filter((event) => kind === 'banner' && event.kind === kind
          && isSameScheduleCycle(event, { ...event, startAt, endAt, sourceUrl: article.url }, false)
          && event.title.split(/\s+·\s+/).every((name) => identity(name).length >= 2 && identity(articleTitle).includes(identity(name))));
        const native = nativeMatches.length === 1 ? nativeMatches[0] : undefined;
        const baseTitle = matchingIssues[0]?.title ?? articleTitle;
        const title = label ? `${baseTitle} · ${label}` : baseTitle;
        const id = position === 0 && periodIndex === 0 ? `${game}:announcement:${article.id}:${startAt}`
          : `${game}:announcement:${article.id}:${header}:${periodIndex}:${startAt}`;
        events.push({ id, game, kind, title, startAt, endAt,
          sourceUrl: article.url, sourceLanguage: 'ko-kr', collectionMethod: 'announcement',
          ...(evidence ? { timeEvidence: evidence } : {}),
          ...(native ? { identityKey: native.identityKey ?? native.localizationKey ?? `notice-target:${game}:${native.id}` } : {}),
          description: `공식 한국어 인게임 공지의 기간. ${section}` });
        if (native && !native.identityKey && !native.localizationKey) {
          const index = events.findIndex((event) => event.id === native.id);
          if (index >= 0) events[index] = { ...native, identityKey: `notice-target:${game}:${native.id}` };
        }
        resolved += matchingIssues.length;
        issues = issues.filter((issue) => !matchingIssues.includes(issue));
      }
    }
  }
  const challengeTargets = game === 'starrail' ? reconcileSchedules(parsed.events).events : [];
  if (game === 'starrail') for (const article of announcements) {
    const lines = article.description.split('\n').map((line) => line.trim()).filter(Boolean);
    const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '');
    for (const [index, line] of lines.entries()) {
      if (!['혼돈의 기억', '허구 이야기', '종말의 환영'].some((name) => line.startsWith(name)) || line.length > 80) continue;
      const section = lines[index + 1] ?? '';
      const evidence = parseHoyoTimeRange(section, boundaries, article.url);
      if (!evidence) continue;
      const native = challengeTargets.filter((event) => event.kind === 'challenge' && normalize(event.title) === normalize(line)
        && isSameScheduleCycle(event, { ...event, startAt: evidence.start.at, endAt: evidence.end.at, sourceUrl: article.url }, true));
      const event = native.length === 1 ? native[0] : undefined;
      if (!event) continue;
      const identityKey = event.identityKey ?? event.localizationKey ?? `notice-target:${game}:${event.id}`;
      for (const candidate of events) if (candidate.id === event.id) candidate.identityKey = identityKey;
      events.push({ ...event, id: `${game}:announcement:${article.id}:challenge:${index}:${evidence.start.at}`,
        startAt: evidence.start.at, endAt: evidence.end.at, collectionSources: undefined,
        collectionMethod: 'announcement', identityKey,
        localizationKey: undefined, sourceUrl: article.url, timeEvidence: evidence,
        description: `공식 한국어 인게임 공지의 기간. ${line}\n${section}` });
    }
    if (/「이상 중재」[^\n]*버전에 따라 업데이트/.test(article.description)) {
      const theme = /이번 회차 테마:\s*「([^」]+)」/.exec(article.description)?.[1];
      const version = /(\d+\.\d+)\s*버전/.exec(article.title)?.[1];
      const boundary = boundaries.find((candidate) => candidate.version === version);
      if (theme && boundary) for (const event of events) {
        if (event.kind !== 'challenge' || normalize(event.title) !== normalize(theme)
          || Math.abs(Date.parse(event.startAt) - Date.parse(boundary.startAt)) > 86400000
          || Date.parse(boundary.startAt) >= Date.parse(event.endAt)) continue;
        const startEvidence = event.timeEvidence?.start;
        if (startEvidence && Date.parse(startEvidence.at) === Date.parse(event.startAt)
          && ['manual', 'official', 'version-update'].includes(startEvidence.basis)) continue;
        event.collectionSources ??= [{ id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, sourceUrl: event.sourceUrl }];
        event.startAt = boundary.startAt;
        event.timeEvidence = { ...event.timeEvidence, start: { at: boundary.startAt,
          basis: 'version-cycle', precision: 'minute', sourceUrl: article.url } };
      }
    }
  }
  const reconciled = reconcileSchedules(events);
  return { events: reconciled.events, issues: [...issues, ...reconciled.issues], skipped: Math.max(0, parsed.skipped - resolved) };
};
