export interface HistoryTimeRange {
  after: string | null;
  before: string | null;
  label: string | null;
}

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function iso(date: Date) {
  return date.toISOString();
}

export function parseHistoryTimeRange(text: string, now = new Date()): HistoryTimeRange | null {
  const t = text.toLowerCase();
  const today = startOfUtcDay(now);

  if (/\btoday\b/.test(t))
    return { after: iso(today), before: iso(addDays(today, 1)), label: "today" };
  if (/\byesterday\b/.test(t))
    return { after: iso(addDays(today, -1)), before: iso(today), label: "yesterday" };
  if (/\blast\s+7\s+days\b/.test(t))
    return { after: iso(addDays(today, -7)), before: iso(addDays(today, 1)), label: "last 7 days" };
  if (/\blast\s+30\s+days\b/.test(t))
    return {
      after: iso(addDays(today, -30)),
      before: iso(addDays(today, 1)),
      label: "last 30 days",
    };
  if (/\bsince\s+yesterday\b/.test(t))
    return { after: iso(addDays(today, -1)), before: null, label: "since yesterday" };

  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisWeek = addDays(today, mondayOffset);
  if (/\bthis\s+week\b/.test(t))
    return { after: iso(thisWeek), before: iso(addDays(thisWeek, 7)), label: "this week" };
  if (/\blast\s+week\b/.test(t))
    return { after: iso(addDays(thisWeek, -7)), before: iso(thisWeek), label: "last week" };

  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (/\bthis\s+month\b/.test(t))
    return { after: iso(thisMonth), before: iso(addMonths(thisMonth, 1)), label: "this month" };
  if (/\blast\s+month\b/.test(t))
    return { after: iso(addMonths(thisMonth, -1)), before: iso(thisMonth), label: "last month" };

  const inYear = t.match(/\bin\s+(20\d{2})\b/);
  if (inYear) {
    const year = Number(inYear[1]);
    return {
      after: new Date(Date.UTC(year, 0, 1)).toISOString(),
      before: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
      label: "in " + year,
    };
  }

  const inMonth = t.match(
    /\bin\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/,
  );
  if (inMonth) {
    const month = MONTHS[inMonth[1]];
    const year = inMonth[2] ? Number(inMonth[2]) : now.getUTCFullYear();
    const start = new Date(Date.UTC(year, month, 1));
    return {
      after: iso(start),
      before: iso(addMonths(start, 1)),
      label: "in " + inMonth[1] + " " + year,
    };
  }

  return null;
}
