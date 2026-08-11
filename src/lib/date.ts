import type { Period } from '../types';

export const PERIOD_HOURS = 3.5;

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Monday of the week containing d */
export function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function getWorkingDaysOfWeek(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 5; i++) days.push(addDays(weekStart, i));
  return days;
}

export function getWeeks(startDate: Date, count: number): Date[][] {
  const weeks: Date[][] = [];
  let cursor = startOfWeek(startDate);
  for (let i = 0; i < count; i++) {
    weeks.push(getWorkingDaysOfWeek(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

const WEEKDAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_LABELS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

export function formatDayLabel(d: Date): string {
  return `${WEEKDAY_LABELS[d.getDay()]} ${d.getDate()}`;
}

export function formatDateLong(d: Date): string {
  return `${WEEKDAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

export function formatWeekRange(days: Date[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  return `${first.getDate()} ${MONTH_LABELS[first.getMonth()]} – ${last.getDate()} ${MONTH_LABELS[last.getMonth()]}`;
}

export function isToday(d: Date): boolean {
  return toISODate(d) === toISODate(new Date());
}

export function currentPeriod(): Period {
  return new Date().getHours() < 13 ? 'matin' : 'apres_midi';
}
