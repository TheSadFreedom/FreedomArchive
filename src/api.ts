import { invoke } from "@tauri-apps/api/core";
import type { Entry } from "./types";

export function listEntries(): Promise<Entry[]> {
  return invoke<Entry[]>("list_entries");
}

export function addEntry(args: {
  sourcePath?: string;
  sourceUrl?: string;
  category: string;
  subcategory: string | null;
  rating: number;
  title: string;
}): Promise<Entry> {
  return invoke<Entry>("add_entry", args);
}

export function updateCard(
  relativePath: string,
  fields: Record<string, string>,
): Promise<Entry> {
  return invoke<Entry>("update_card", { relativePath, fields });
}

export function deleteEntry(relativePath: string): Promise<void> {
  return invoke<void>("delete_entry", { relativePath });
}

export function moveEntry(args: {
  relativePath: string;
  category: string;
  subcategory: string | null;
  rating: number;
  title: string;
}): Promise<Entry> {
  return invoke<Entry>("move_entry", args);
}

export function lookupMeta(
  category: string,
  title: string,
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("lookup_meta", { category, title });
}

export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Неизвестная ошибка";
}
