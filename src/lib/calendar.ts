/**
 * Build-time fetch of the public Google Calendar ICS feed.
 * Fails soft: if the calendar is private, empty, or unreachable we return [].
 * Recurring events are expanded for simple weekly/daily RRULEs only.
 */
export interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  url?: string;
  source: 'calendar' | 'manual';
}

export function icsUrl(calendarId: string): string {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
}

export function embedUrl(calendarId: string, tz = 'America/Detroit'): string {
  const u = new URL('https://calendar.google.com/calendar/embed');
  u.searchParams.set('src', calendarId);
  u.searchParams.set('ctz', tz);
  u.searchParams.set('mode', 'AGENDA');
  u.searchParams.set('showTitle', '0');
  u.searchParams.set('showPrint', '0');
  u.searchParams.set('showCalendars', '0');
  u.searchParams.set('bgcolor', '%23ffffff');
  return u.toString();
}

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
}

function unescapeText(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
}

function parseDate(value: string, params: Record<string, string>): { date: Date; allDay: boolean } | null {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!m) return null;
    // All-day: noon Detroit time so the calendar day survives TZ conversion.
    return { date: new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00-04:00`), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  if (m[7] === 'Z') return { date: new Date(iso + 'Z'), allDay: false };
  // Floating or TZID time. Google exports Detroit calendars with TZID=America/Detroit (or New_York).
  const offset = detroitOffset(new Date(iso + 'Z'));
  return { date: new Date(iso + offset), allDay: false };
}

/** Rough EST/EDT offset for a given instant (DST: 2nd Sun Mar → 1st Sun Nov). */
function detroitOffset(d: Date): string {
  const y = d.getUTCFullYear();
  const secondSunMar = new Date(Date.UTC(y, 2, 1));
  secondSunMar.setUTCDate(1 + ((7 - secondSunMar.getUTCDay()) % 7) + 7);
  const firstSunNov = new Date(Date.UTC(y, 10, 1));
  firstSunNov.setUTCDate(1 + ((7 - firstSunNov.getUTCDay()) % 7));
  return d >= secondSunMar && d < firstSunNov ? '-04:00' : '-05:00';
}

export function parseIcs(text: string, now = new Date(), horizonDays = 120): CalEvent[] {
  const lines = unfold(text);
  const out: CalEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT' && cur) { pushEvent(cur, out, now, horizonDays); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...paramParts] = head.split(';');
    const params: Record<string, string> = {};
    for (const p of paramParts) { const [k, v] = p.split('='); if (k && v) params[k] = v; }
    cur[name!] = { value, params };
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function pushEvent(e: Record<string, { value: string; params: Record<string, string> }>, out: CalEvent[], now: Date, horizonDays: number) {
  if (e.STATUS?.value === 'CANCELLED') return;
  const ds = e.DTSTART ? parseDate(e.DTSTART.value, e.DTSTART.params) : null;
  if (!ds) return;
  const de = e.DTEND ? parseDate(e.DTEND.value, e.DTEND.params) : null;
  const base: Omit<CalEvent, 'id' | 'start' | 'end'> = {
    title: unescapeText(e.SUMMARY?.value ?? 'Untitled event'),
    allDay: ds.allDay,
    location: e.LOCATION ? unescapeText(e.LOCATION.value) : undefined,
    description: e.DESCRIPTION ? unescapeText(e.DESCRIPTION.value) : undefined,
    url: e.URL?.value,
    source: 'calendar',
  };
  const uid = e.UID?.value ?? Math.random().toString(36).slice(2);
  const horizon = new Date(now.getTime() + horizonDays * 86400e3);
  const dur = de ? de.date.getTime() - ds.date.getTime() : 0;
  const cutoff = new Date(now.getTime() - 86400e3);

  const rrule = e.RRULE?.value;
  if (!rrule) {
    if (ds.date >= cutoff) out.push({ id: uid, start: ds.date, end: de?.date, ...base });
    return;
  }
  // Minimal RRULE expansion: FREQ=WEEKLY|DAILY with optional INTERVAL/UNTIL/COUNT.
  const r = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=') as [string, string]));
  const step = r.FREQ === 'WEEKLY' ? 7 : r.FREQ === 'DAILY' ? 1 : 0;
  if (!step) { if (ds.date >= cutoff) out.push({ id: uid, start: ds.date, end: de?.date, ...base }); return; }
  const interval = Number(r.INTERVAL ?? 1) || 1;
  const until = r.UNTIL ? parseDate(r.UNTIL, {})?.date : undefined;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const exdates = new Set<string>();
  for (const k of Object.keys(e)) if (k === 'EXDATE') for (const v of e[k]!.value.split(',')) { const p = parseDate(v, e[k]!.params); if (p) exdates.add(p.date.toISOString().slice(0, 10)); }
  let n = 0;
  for (let t = ds.date.getTime(); n < count && t <= horizon.getTime(); t += step * interval * 86400e3, n++) {
    const start = new Date(t);
    if (until && start > until) break;
    if (start < cutoff) continue;
    if (exdates.has(start.toISOString().slice(0, 10))) continue;
    out.push({ id: `${uid}-${n}`, start, end: dur ? new Date(t + dur) : undefined, ...base });
  }
}

export async function fetchCalendarEvents(calendarId: string | undefined, limit = 8): Promise<CalEvent[]> {
  if (!calendarId) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(icsUrl(calendarId), { signal: ctrl.signal });
    if (!res.ok) { console.warn(`[calendar] ICS fetch returned ${res.status}; is the calendar public?`); return []; }
    const text = await res.text();
    return parseIcs(text).slice(0, limit);
  } catch (err) {
    console.warn('[calendar] ICS fetch failed:', (err as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
