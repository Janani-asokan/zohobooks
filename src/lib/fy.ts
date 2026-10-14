/** Indian financial year: 1 April → 31 March. */
export function fyStartYear(date: Date | string = new Date(), startMonth = 4): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const m = d.getMonth() + 1;
  return m >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
}

export function fyLabel(date: Date | string = new Date(), startMonth = 4): string {
  const y = fyStartYear(date, startMonth);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function fyRange(date: Date | string = new Date(), startMonth = 4) {
  const y = fyStartYear(date, startMonth);
  const start = new Date(y, startMonth - 1, 1);
  const end = new Date(y + 1, startMonth - 1, 0);
  return { start, end };
}

export function daysUntil(iso: string): number {
  const ms = new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}
