import type { Entry } from "../types";
import { displayTitle } from "../title";

export type SortKey = "title" | "rating" | "released";
export type SortDir = "asc" | "desc";

export function defaultSortDir(key: SortKey): SortDir {
  return key === "title" ? "asc" : "desc";
}

export function releaseStamp(fields: Record<string, string>): number | null {
  const raw = (fields.released || fields.year || "").trim();
  if (!raw) return null;

  const dotted = raw.match(/(\d{1,2})\.(\d{1,2})\.((?:18|19|20)\d{2})/);
  if (dotted) {
    return Number(dotted[3]) * 10000 + Number(dotted[2]) * 100 + Number(dotted[1]);
  }

  const iso = raw.match(/((?:18|19|20)\d{2})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
  }

  const spaced = raw.match(/(\d{1,2})\s+(\d{1,2})\s+((?:18|19|20)\d{2})/);
  if (spaced) {
    return Number(spaced[3]) * 10000 + Number(spaced[2]) * 100 + Number(spaced[1]);
  }

  const yearMonth = raw.match(/((?:18|19|20)\d{2})-(\d{1,2})\b/);
  if (yearMonth) {
    return Number(yearMonth[1]) * 10000 + Number(yearMonth[2]) * 100;
  }

  const year = raw.match(/\b(?:18|19|20)\d{2}\b/);
  return year ? Number(year[0]) * 10000 : null;
}

function byTitle(left: Entry, right: Entry): number {
  return displayTitle(left.title).localeCompare(displayTitle(right.title), "ru", {
    sensitivity: "base",
  });
}

export function compareEntries(left: Entry, right: Entry, key: SortKey, dir: SortDir): number {
  if (key === "title") {
    const result = byTitle(left, right);
    return dir === "asc" ? result : -result;
  }
  if (key === "rating") {
    const result = left.rating - right.rating;
    if (result === 0) return byTitle(left, right);
    return dir === "asc" ? result : -result;
  }
  const earlier = releaseStamp(left.fields);
  const later = releaseStamp(right.fields);
  if (earlier == null && later == null) return byTitle(left, right);
  if (earlier == null) return 1;
  if (later == null) return -1;
  if (earlier === later) return byTitle(left, right);
  return dir === "asc" ? earlier - later : later - earlier;
}
