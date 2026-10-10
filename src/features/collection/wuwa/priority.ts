import type { CalendarEvent } from '../../../../shared/calendar';
import { reconcileSchedules, scheduleTitleKey, isSameScheduleCycle } from '../reconciliation';

export const linkWuwaSources = (primary: CalendarEvent[], fallback: CalendarEvent[], aliases: { title: string; targetTitle: string }[] = []) => {
  const linked = fallback.map((event) => {
    if (event.kind !== 'banner') return event;
    const targets = [...new Set(aliases.filter((alias) => scheduleTitleKey({ ...event, title: alias.title }) === scheduleTitleKey(event)).map((alias) => alias.targetTitle))];
    if (targets.length !== 1) return event;
    const matches = primary.filter((candidate) => candidate.kind === 'banner'
      && scheduleTitleKey(candidate) === scheduleTitleKey({ ...event, title: targets[0] ?? '' })
      && isSameScheduleCycle(candidate, event, false));
    const identities = [...new Set(matches.map((match) => match.identityKey ?? match.localizationKey).filter(Boolean))];
    return identities.length === 1 ? { ...event, identityKey: identities[0], collectionMethod: 'announcement' as const } : event;
  });
  return [...primary, ...linked];
};

export const mergeWuwaSources = (primary: CalendarEvent[], fallback: CalendarEvent[], aliases: { title: string; targetTitle: string }[] = []) =>
  reconcileSchedules(linkWuwaSources(primary, fallback, aliases)).events;
