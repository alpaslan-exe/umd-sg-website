const TZ = 'America/Detroit';

export function fmtDate(d: Date | string, opts: Intl.DateTimeFormatOptions = {}): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', ...opts }).format(date);
}

/** Date-only values (post dates like 2026-09-03) parse as UTC midnight; format them in UTC so the day never shifts. */
export function fmtDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function fmtTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(date);
}

export function fmtDayParts(d: Date): { month: string; day: string; weekday: string } {
  const p = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).format(d);
  return { month: p({ month: 'short' }), day: p({ day: 'numeric' }), weekday: p({ weekday: 'short' }) };
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
