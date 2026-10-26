import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import { deleteEntry, errorText, lookupMeta, moveEntry, updateCard } from "../api";
import { Cover } from "./Cover";
import { Stars } from "./Stars";
import {
  categories,
  categoryById,
  fieldsFor,
  placement,
  usesRating,
  type FieldDef,
} from "../schema/categories";
import type { Entry } from "../types";

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

type ListMode = "single" | "comma" | "lines";

function suggestionKey(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

function listMode(category: string, key: string): ListMode {
  if (key === "actors") return "lines";
  if (category === "аниме" && animeListKeys.has(key)) return "comma";
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
  const [looking, setLooking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setTitle(entry.title);
    setCategory(entry.category);
    setSubcategory(entry.subcategory ?? "");
    setRating(entry.rating);
    setFields(entry.fields);
    setError("");
    setLooking(false);
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
    setError("");
    setBusy(true);
    try {
      const nextTitle = title.trim();
      const nextSub = subs.length && subcategory ? subcategory : null;
      const nextRating = rated ? rating : 0;
      const placementChanged =
        nextTitle !== entry.title.trim() ||
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
        });
        relativePath = moved.relativePath;
      }
      const payload: Record<string, string> = {};
      for (const field of fieldDefs) {
        payload[field.key] = fields[field.key] ?? "";
      }
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

  async function autoLookup() {
    const query = title.trim();
    if (!query) {
      setError("сначала укажите название");
      return;
    }
    setError("");
    setLooking(true);
    try {
      const found = await lookupMeta(category, query);
      const allowed = new Set(fieldDefs.map((field) => field.key));
      setFields((current) => {
        const next = { ...current };
        for (const [key, value] of Object.entries(found)) {
          if (!allowed.has(key) || !value.trim()) continue;
          next[key] = value;
        }
        return next;
      });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLooking(false);
    }
  }

  const summary = fieldDefs.find((field) => field.key === "summary");
  const actors = fieldDefs.find((field) => field.key === "actors");
  const themes = fieldDefs.find((field) => field.key === "themes" || field.key === "theme");
  const altTitle = fieldDefs.find((field) => field.key === "altTitle");
  const facts = fieldDefs.filter(
    (field) =>
      field.key !== "summary" &&
      field.key !== "actors" &&
      field.key !== "themes" &&
      field.key !== "theme" &&
      field.key !== "altTitle",
  );
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
  const canLookup =
    category === "аниме" ||
    category === "манга" ||
    category === "кино" ||
    category === "мульт" ||
    category === "игры" ||
    category === "книги";
  const subTitle = subs.find((item) => item.id === subcategory)?.title;
  const place = [current?.title, subTitle].filter(Boolean).join(" · ");
  const locked = busy || looking || confirming;

  return (
    <form
      ref={formRef}
      className="card-page editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-title"
      onSubmit={save}
    >
      <header className="card-page-bar">
        <button type="button" className="card-icon card-back" aria-label="Назад" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <path
              fill="currentColor"
              d="M14.8 5.2 8.1 12l6.7 6.8 1.5-1.5L11.1 12l5.2-5.3-1.5-1.5Z"
            />
          </svg>
        </button>
        <p className="add-kicker">{place || "Карточка"}</p>
        <div className="editor-actions">
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
            <>
              {canLookup && (
                <button
                  type="button"
                  className="ghost lookup"
                  disabled={locked || !title.trim()}
                  onClick={autoLookup}
                  title={
                    category === "аниме" || category === "манга"
                      ? "Найти на Shikimori"
                      : category === "кино" || category === "мульт"
                        ? "Найти на Кинопоиске"
                        : category === "игры"
                          ? "Найти в Steam"
                          : "Найти на LitRes"
                  }
                >
                  {looking ? "Ищу…" : "Авто-поиск"}
                </button>
              )}
              <button type="button" className="ghost danger-quiet" disabled={locked} onClick={() => setConfirming(true)}>
                Удалить
              </button>
            </>
          )}
          <button type="submit" className="primary" disabled={locked || !title.trim()}>
            {busy && !confirming ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </header>

      <div className="card-page-body">
        <aside className="card-poster">
          <Cover imagePath={entry.imagePath} title={title || entry.title} />
          {rated && (
            <div className="card-score">
              <Stars value={rating} onChange={setRating} />
            </div>
          )}
          <p className="editor-path">
            {folder}/{title.trim() || "…"}
          </p>
        </aside>

        <div className="card-page-main">
          <div className="card-names">
            <textarea
              id="card-title"
              className="card-name"
              rows={2}
              value={title}
              onChange={(event) => setTitle(event.target.value.replace(/\s*\n\s*/g, " "))}
              required
              aria-label="Название"
              placeholder="Название"
            />
            {altTitle && (
              <textarea
                className="card-alt"
                rows={2}
                value={fields.altTitle ?? ""}
                onChange={(event) =>
                  setFields((currentFields) => ({
                    ...currentFields,
                    altTitle: event.target.value.replace(/\s*\n\s*/g, " "),
                  }))
                }
                aria-label="Альтернативное название"
                placeholder="Альтернативное название"
              />
            )}
          </div>

          {!focused && (
            <div className="editor-place">
              <label>
                <span className="editor-label">Категория</span>
                <select value={category} onChange={(event) => chooseCategory(event.target.value)}>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              {subs.length > 0 && (
                <label>
                  <span className="editor-label">Подкатегория</span>
                  <select value={subcategory} onChange={(event) => setSubcategory(event.target.value)}>
                    {subs.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {facts.length > 0 && (
            <div className="editor-grid">
              {facts.map((field) => (
                <FieldControl
                  key={field.key}
                  field={field}
                  fields={fields}
                  setFields={setFields}
                  list={listMode(category, field.key)}
                  options={
                    plainFields.has(field.key)
                      ? []
                      : (listMode(category, field.key) === "single" ? known.whole[field.key] : known.listed[field.key]) ??
                        []
                  }
                />
              ))}
            </div>
          )}

          {actors && (
            <section className="editor-section">
              <FieldControl field={actors} fields={fields} setFields={setFields} list="lines" options={known.listed.actors ?? []} />
            </section>
          )}

          {summary && (
            <section className="editor-section">
              <FieldControl field={summary} fields={fields} setFields={setFields} list="single" options={[]} />
            </section>
          )}

          {themes && (
            <section className="editor-section">
              <FieldControl field={themes} fields={fields} setFields={setFields} list="single" options={[]} />
            </section>
          )}

          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </form>
  );
}
