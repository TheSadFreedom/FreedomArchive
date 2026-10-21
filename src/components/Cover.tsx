import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

type CoverProps = {
  imagePath: string;
  title: string;
  lazy?: boolean;
};

const watchers = new Map<Element, (visible: boolean) => void>();
let watcher: IntersectionObserver | null = null;

function observe(node: Element, onChange: (visible: boolean) => void) {
  if (!watcher) {
    watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          watchers.get(entry.target)?.(entry.isIntersecting);
        }
      },
      { rootMargin: "160px 0px" },
    );
  }
  watchers.set(node, onChange);
  watcher.observe(node);
  return () => {
    watcher?.unobserve(node);
    watchers.delete(node);
  };
}

export function Cover({ imagePath, title, lazy = false }: CoverProps) {
  const hold = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(!lazy);

  useEffect(() => {
    if (!lazy) return;
    const node = hold.current;
    if (!node) return;
    return observe(node, setShown);
  }, [lazy]);

  if (!lazy) {
    return <img className="cover" src={convertFileSrc(imagePath)} alt="" title={title} />;
  }

  return (
    <span className="cover-hold" ref={hold}>
      {shown && <img className="cover" src={convertFileSrc(imagePath)} alt="" title={title} />}
    </span>
  );
}
