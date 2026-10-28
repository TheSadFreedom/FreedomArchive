import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { Entry } from "../types";
import { displayTitle } from "../title";

type CoverZoomProps = {
  entry: Entry;
  onClose: () => void;
};

export function CoverZoom({ entry, onClose }: CoverZoomProps) {
  const title = displayTitle(entry.title);
  const alt = entry.fields.altTitle?.trim() ?? "";
  const released = entry.fields.released?.trim() ?? "";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <button
      type="button"
      className="cover-zoom"
      aria-label={`Закрыть: ${title}`}
      onClick={onClose}
    >
      <span className="cover-zoom-panel" onClick={(event) => event.stopPropagation()}>
        <img
          className="cover-zoom-image"
          src={convertFileSrc(entry.imagePath)}
          alt=""
          title={title}
        />
        <span className="cover-zoom-info">
          <span className="cover-zoom-title">{title}</span>
          {alt ? <span className="cover-zoom-alt">{alt}</span> : null}
          {released ? <span className="cover-zoom-date">{released}</span> : null}
        </span>
      </span>
    </button>
  );
}
