import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import { deleteEntry, errorText, moveEntry, updateCard } from "../api";
import { Cover } from "./Cover";
import { PlacementPicker } from "./PlacementPicker";
import { Stars } from "./Stars";
import {
  categoryById,
  fieldsFor,
  placement,
  usesRating,
  type FieldDef,
} from "../schema/categories";
import type { Entry } from "../types";
import { fileStem, releaseYear } from "../title";

type CardDialogProps = {
  entry: Entry;
  entries: Entry[];
  onClose: () => void;
  onSaved: (relativePath: string) => Promise<void>;
  onDeleted: () => Promise<void>;
};

const hints: Record<string, string> = {
  themes: "через запятую",
  theme: "через запятую",
  actors: "через запятую или с новой строки",
};

const plainFields = new Set(["genre", "themes", "theme", "summary"]);
const animeListKeys = new Set(["director", "franchise", "studio", "country"]);
const queueShelves = new Set(["планы", "ожидание", "пересмотр", "брошено"]);

type ListMode = "single" | "comma" | "lines";

function suggestionKey(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

function listMode(category: string, subcategory: string, key: string): ListMode {
  if (key === "actors") return "lines";
  const queued = queueShelves.has(category);
  const anime = category === "аниме" || (queued && subcategory === "аниме");
  if (anime && animeListKeys.has(key)) return "comma";
  return "single";
}

function tokens(raw: string, mode: Exclude<ListMode, "single">): string[] {
  const source = mode === "lines" ? raw.split(/[\n,]/) : raw.split(",");
  return source.map((item) => item.trim()).filter(Boolean);
}

function lastBreak(value: string, mode: Exclude<ListMode, "single">): number {
  if (mode === "lines") return Math.max(value.lastIndexOf(","), value.lastIndexOf("\n"));
  return value.lastIndexOf(",");
}

function sortedLabels(bucket: Map<string, { label: string; count: number }>): string[] {
  return [...bucket.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ru"))
    .map((item) => item.label);
}

function suggestionsFrom(
  entries: Entry[],
  skipPath: string,
): { whole: Record<string, string[]>; listed: Record<string, string[]> } {
  const whole = new Map<string, Map<string, { label: string; count: number }>>();
  const listed = new Map<string, Map<string, { label: string; count: number }>>();

  function push(bags: Map<string, Map<string, { label: string; count: number }>>, key: string, label: string) {
    const id = suggestionKey(label);
    if (!id) return;
    let bucket = bags.get(key);
    if (!bucket) {
      bucket = new Map();
      bags.set(key, bucket);
    }
    const found = bucket.get(id);
    if (found) found.count += 1;
    else bucket.set(id, { label, count: 1 });
  }

  for (const item of entries) {
    if (item.relativePath === skipPath) continue;
    for (const [key, raw] of Object.entries(item.fields)) {
      if (!raw?.trim() || plainFields.has(key)) continue;
      if (key === "actors") {
        for (const label of tokens(raw, "lines")) push(listed, key, label);
        continue;
      }
      push(whole, key, raw.trim());
      if (animeListKeys.has(key)) {
        for (const label of tokens(raw, "comma")) push(listed, key, label);
      }
    }
  }

  const wholeResult: Record<string, string[]> = {};
  const listedResult: Record<string, string[]> = {};
  for (const [key, bucket] of whole) wholeResult[key] = sortedLabels(bucket);
  for (const [key, bucket] of listed) listedResult[key] = sortedLabels(bucket);
  return { whole: wholeResult, listed: listedResult };
}

function withChoice(value: string, choice: string, mode: ListMode): string {
  if (mode === "single") return choice;
  const index = lastBreak(value, mode);
  if (index === -1) return choice;
  const head = value.slice(0, index + 1);
  const gap = head.endsWith("\n") || head.endsWith(" ") ? "" : " ";
  return `${head}${gap}${choice}`;
}

function FieldControl({
  field,
  fields,
  setFields,
  options,
  list,
}: {
  field: FieldDef;
  fields: Record<string, string>;
  setFields: Dispatch<SetStateAction<Record<string, string>>>;
  options: string[];
  list: ListMode;
}) {
  const hint = hints[field.key] ?? (list === "comma" ? "через запятую" : undefined);
  const listField = list !== "single";
  const roomy = field.key === "genre" || field.key === "themes" || field.key === "theme";
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [active, setActive] = useState(0);

  function reveal() {
    const rect = anchor.current?.getBoundingClientRect();
    setAbove(Boolean(rect && window.innerHeight - rect.bottom < 300));
    setOpen(true);
  }
  const value = fields[field.key] ?? "";
  const query = (listField ? value.slice(lastBreak(value, list === "lines" ? "lines" : "comma") + 1) : value).trim();
  const needle = suggestionKey(query);
  const taken = new Set(listField ? tokens(value, list === "lines" ? "lines" : "comma").map(suggestionKey) : []);
  const matches = options
    .filter((option) => {
      const key = suggestionKey(option);
      if (listField && !needle && taken.has(key)) return false;
      if (!needle) return true;
      return key.includes(needle) && key !== needle;
    })
    .slice(0, 8);

  function choose(choice: string) {
    setFields((currentFields) => ({
      ...currentFields,
      [field.key]: withChoice(currentFields[field.key] ?? "", choice, list),
    }));
    setOpen(false);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!open || matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" && matches[active]) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  const control = field.kind === "textarea" || roomy ? (
    <textarea
      rows={field.key === "summary" ? 7 : 4}
      value={value}
      onFocus={reveal}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
      onChange={(event) => {
        setActive(0);
        reveal();
        setFields((currentFields) => ({ ...currentFields, [field.key]: event.target.value }));
      }}
    />
  ) : (
    <input
      type={field.kind === "number" ? "number" : "text"}
      value={value}
      onFocus={reveal}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
      onChange={(event) => {
        setActive(0);
        reveal();
        setFields((currentFields) => ({ ...currentFields, [field.key]: event.target.value }));
      }}
    />
  );

  return (
    <div className={["editor-field", field.kind === "textarea" || roomy ? "wide" : "", roomy ? "roomy" : ""].filter(Boolean).join(" ")}>
      <span className="editor-label">
        {field.label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <div className={above ? "suggest above" : "suggest"} ref={anchor}>
        {control}
        {open && matches.length > 0 && (
          <ul className="suggest-list" role="listbox">
            {matches.map((option, index) => (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? "on" : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {(field.key === "themes" || field.key === "theme") && (
        <span className="card-pills editor-pills">
          {(fields[field.key] ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => (
              <span key={item} className="card-pill">
                {item}
              </span>
            ))}
        </span>
      )}
    </div>
  );
}

export function CardDialog({ entry, entries, onClose, onSaved, onDeleted }: CardDialogProps) {
  const [title, setTitle] = useState(entry.title);
  const [category, setCategory] = useState(entry.category);
  const [subcategory, setSubcategory] = useState(entry.subcategory ?? "");
  const [rating, setRating] = useState(entry.rating);
  const [fields, setFields] = useState<Record<string, string>>(entry.fields);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setTitle(entry.title);
    setCategory(entry.category);
    setSubcategory(entry.subcategory ?? "");
    setRating(entry.rating);
    setFields(entry.fields);
    setError("");
    setConfirming(false);
  }, [entry]);

  useEffect(() => {
    if (!confirming) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setConfirming(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirming]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = categoryById(category);
  const subs = current?.subcategories ?? [];
  const fieldDefs = fieldsFor(category, subcategory);
  const rated = usesRating(category);
  const year = releaseYear(fields.released ?? "");
  const stem = year && title.trim() ? fileStem(title.trim(), year) : "";
  const folder = useMemo(
    () => placement(category, subs.length ? subcategory : null, rated ? rating : 0),
    [category, subcategory, subs.length, rating, rated],
  );

  function chooseCategory(id: string) {
    setCategory(id);
    const next = categoryById(id);
    setSubcategory(next?.subcategories?.[0].id ?? "");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextReleased = (fields.released ?? "").trim();
    const nextYear = releaseYear(nextReleased);
    if (!nextYear) {
      setError("укажите год в дате выхода");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const nextSub = subs.length && subcategory ? subcategory : null;
      const nextRating = rated ? rating : 0;
      const nextStem = fileStem(nextTitle, nextYear);
      const currentFile = entry.relativePath.split("/").pop() ?? "";
      const currentStem = currentFile.replace(/\.[^.]+$/, "");
      const placementChanged =
        nextStem !== currentStem ||
        category !== entry.category ||
        nextSub !== (entry.subcategory ?? null) ||
        nextRating !== entry.rating;
      let relativePath = entry.relativePath;
      if (placementChanged) {
        const moved = await moveEntry({
          relativePath,
          category,
          subcategory: nextSub,
          rating: nextRating,
          title: nextTitle,
          year: nextYear,
        });
        relativePath = moved.relativePath;
      }
      const payload: Record<string, string> = {
        title: nextTitle,
      };
      for (const field of fieldDefs) {
        payload[field.key] = fields[field.key] ?? "";
      }
      payload.released = nextReleased;
      await updateCard(relativePath, payload);
      await onSaved(relativePath);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError("");
    setBusy(true);
    try {
      await deleteEntry(entry.relativePath);
      await onDeleted();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  const altTitle = fieldDefs.find((field) => field.key === "altTitle");
  const facts = fieldDefs.filter((field) => field.key !== "altTitle");
  const known = useMemo(
    () => suggestionsFrom(entries, entry.relativePath),
    [entries, entry.relativePath],
  );
  const focused =
    category === "аниме" ||
    category === "кино" ||
    category === "игры" ||
    category === "манга" ||
    category === "мульт";
  const subTitle = subs.find((item) => item.id === subcategory)?.title;
  const place = [current?.title, subTitle].filter(Boolean).join(" · ");
  const locked = busy || confirming;

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form
        ref={formRef}
        className="dialog edit-dialog editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={save}
      >
        <header className="add-head">
          <div>
            <p className="add-kicker">{place || "Карточка"}</p>
            <h2 id="edit-heading">Редактирование</h2>
          </div>
          <button type="button" className="card-icon" aria-label="Закрыть" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z"
              />
            </svg>
          </button>
        </header>

        <p className="editor-path edit-path">
          {folder}/{stem || "Название (Год)"}
        </p>

        <div className="edit-layout">
          <div className="edit-photo">
            <div className="edit-cover">
              <Cover imagePath={entry.imagePath} title={title || entry.title} />
            </div>
            {rated && (
              <div className="add-score">
                <Stars value={rating} onChange={setRating} />
              </div>
            )}
          </div>

          <div className="edit-fields">
            <label>
              <span className="editor-label">Название</span>
              <input
                id="card-title"
                className="add-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                autoFocus
              />
            </label>

            {altTitle && (
              <label>
                <span className="editor-label">{altTitle.label}</span>
                <input
                  value={fields.altTitle ?? ""}
                  onChange={(event) =>
                    setFields((currentFields) => ({
                      ...currentFields,
                      altTitle: event.target.value,
                    }))
                  }
                />
              </label>
            )}

            {facts.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                fields={fields}
                setFields={setFields}
                list={listMode(category, subcategory, field.key)}
                options={
                  plainFields.has(field.key)
                    ? []
                    : (listMode(category, subcategory, field.key) === "single"
                        ? known.whole[field.key]
                        : known.listed[field.key]) ?? []
                }
              />
            ))}

            {!focused && (
              <PlacementPicker
                category={category}
                subcategory={subcategory}
                onCategory={chooseCategory}
                onSubcategory={setSubcategory}
              />
            )}
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <footer className="dialog-actions edit-actions">
          {confirming ? (
            <>
              <span className="editor-confirm">Удалить запись?</span>
              <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Отмена
              </button>
              <button type="button" className="danger" disabled={busy} onClick={remove}>
                {busy ? "Удаляю…" : "Удалить"}
              </button>
            </>
          ) : (
            <button type="button" className="ghost danger-quiet" disabled={locked} onClick={() => setConfirming(true)}>
              Удалить
            </button>
          )}
          <button type="submit" className="primary" disabled={locked || !title.trim()}>
            {busy && !confirming ? "Сохраняю…" : "Сохранить"}
          </button>
        </footer>
      </form>
    </div>
  );
}
