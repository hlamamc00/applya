import { clsx, type ClassValue } from "clsx";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: Date | string | null | undefined, pattern = "d MMM yyyy") {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? "" : format(d, pattern);
}

export function formatDateTime(date: Date | string | null | undefined) {
  return formatDate(date, "d MMM yyyy, HH:mm");
}

/** "2024-03" or "2024" or "Present" as typed in the editor, shown as-is. */
export function monthLabel(value: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  return format(new Date(Number(m[1]), Number(m[2]) - 1, 1), "MMM yyyy");
}

export function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Lines typed one per line in a textarea, trimmed, blanks dropped. */
export function lines(value: FormDataEntryValue | null | undefined) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** "a, b, c" or one per line, trimmed, blanks dropped, duplicates removed. */
export function list(value: FormDataEntryValue | null | undefined) {
  const out = String(value ?? "")
    .split(/[\n,]/)
    .map((l) => l.trim())
    .filter(Boolean);
  return Array.from(new Set(out));
}

export function str(value: FormDataEntryValue | null | undefined) {
  return String(value ?? "").trim();
}

export function int(value: FormDataEntryValue | null | undefined): number | null {
  const n = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** Filename-safe "First_Last" for the CV download. */
export function fileSafeName(first: string, last: string) {
  const clean = (s: string) => s.normalize("NFKD").replace(/[^\w]+/g, "").trim();
  return [clean(first), clean(last)].filter(Boolean).join("_") || "Applicant";
}
