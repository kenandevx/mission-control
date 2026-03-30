// Luxon 3.x type stub — @types/luxon not installed; covers used API
declare module "luxon" {
  export class DateTime {
    static fromISO(iso: string, opts?: { zone?: string }): DateTime;
    static fromMillis(ms: number, opts?: { zone?: string }): DateTime;
    static fromJSDate(date: Date, opts?: { zone?: string }): DateTime;
    static fromObject(obj: Record<string, unknown>, opts?: { zone?: string }): DateTime;
    static now(): DateTime;

    toUTC(offset?: number): DateTime;
    toJSDate(): Date;
    toISO(): string;
    toISODate(): string;
    toLocaleString(opts?: Intl.DateTimeFormatOptions): string;
    toFormat(format: string): string;

    readonly offset: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
    readonly day: number;
    readonly month: number;
    readonly year: number;
    readonly weekday: number;
    readonly zoneName: string;
    readonly isValid: boolean;
    readonly ts: number;

    setZone(zone: string, opts?: { keepLocalTime?: boolean }): DateTime;
    set(obj: Record<string, unknown>): DateTime;
    minus(duration: Duration): DateTime;
    plus(duration: Duration): DateTime;
    startOf(unit: string): DateTime;
    endOf(unit: string): DateTime;
    diff(other: DateTime, units?: string[]): Duration;
    hasSame(other: DateTime, unit: string): boolean;
  }

  export class Duration {
    static fromObject(obj: Record<string, number>): Duration;
    as(unit: string): number;
    toMillis(): number;
    minus(other: Duration): Duration;
    plus(other: Duration): Duration;
    shiftTo(...units: string[]): Duration;
  }

  export const Settings: {
    defaultZoneName: string;
    setDefaultZoneName(zone: string): void;
  };

  export const Info: {
    weekdayValues(locale?: string): Record<number, string>;
  };
}
