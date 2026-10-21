import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { deleteEntry, errorText, moveEntry, updateCard } from "../api";
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
  onClose: () => void;
  onSaved: (relativePath: string) => Promise<void>;
  onDeleted: () => Promise<void>;
};

const hints: Record<string, string> = {
  themes: "через запятую",
  theme: "через запятую",
  actors: "через запятую или с новой строки",
};

function FieldControl({
  field,
  fields,
  setFields,
}: {
  field: FieldDef;
  fields: Record<string, string>;
  setFields: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const hint = hints[field.key];
  return (
    <label className={field.kind === "textarea" ? "wide" : undefined}>
      <span className="editor-label">
        {field.label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {field.kind === "textarea" ? (
        <textarea
          rows={field.key === "summary" ? 7 : 4}
          value={fields[field.key] ?? ""}
          onChange={(event) =>
            setFields((currentFields) => ({
              ...currentFields,
              [field.key]: event.target.value,
            }))
          }
        />
      ) : (
        <input
          type={field.kind === "number" ? "number" : "text"}
          value={fields[field.key] ?? ""}
          onChange={(event) =>
            setFields((currentFields) => ({
              ...currentFields,
              [field.key]: event.target.value,
            }))
          }
        />
      )}
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
    </label>
  );
}

export function CardDialog({ entry, onClose, onSaved, onDeleted }: CardDialogProps) {
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
      const nextSub = subs.length && subcategory ? subcategory : null;
      const nextRating = rated ? rating : 0;
      const placementChanged =
        title !== entry.title ||
        category !== entry.category ||
        nextSub !== entry.subcategory ||
        nextRating !== entry.rating;
      let relativePath = entry.relativePath;
      if (placementChanged) {
        const moved = await moveEntry({
          relativePath,
          category,
          subcategory: nextSub,
          rating: nextRating,
          title,
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

  const summary = fieldDefs.find((field) => field.key === "summary");
  const actors = fieldDefs.find((field) => field.key === "actors");
  const themes = fieldDefs.find((field) => field.key === "themes" || field.key === "theme");
  const facts = fieldDefs.filter(
    (field) =>
      field.key !== "summary" &&
      field.key !== "actors" &&
      field.key !== "themes" &&
      field.key !== "theme",
  );
  const focused =
    category === "аниме" ||
    category === "кино" ||
    category === "игры" ||
    category === "манга" ||
    category === "мульт";
  const subTitle = subs.find((item) => item.id === subcategory)?.title;
  const place = [current?.title, subTitle].filter(Boolean).join(" · ");

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
            <button type="button" className="ghost danger-quiet" disabled={busy} onClick={() => setConfirming(true)}>
              Удалить
            </button>
          )}
          <button type="submit" className="primary" disabled={busy || confirming || !title.trim()}>
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
          <input
            id="card-title"
            className="card-name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            aria-label="Название"
            placeholder="Название"
          />

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
                <FieldControl key={field.key} field={field} fields={fields} setFields={setFields} />
              ))}
            </div>
          )}

          {actors && (
            <section className="editor-section">
              <FieldControl field={actors} fields={fields} setFields={setFields} />
            </section>
          )}

          {summary && (
            <section className="editor-section">
              <FieldControl field={summary} fields={fields} setFields={setFields} />
            </section>
          )}

          {themes && (
            <section className="editor-section">
              <FieldControl field={themes} fields={fields} setFields={setFields} />
            </section>
          )}

          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </form>
  );
}
