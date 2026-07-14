import { useEffect, useRef } from "react";
import type { LocaleCode } from "../imdf/types";
import { focusFeatureMarker } from "../map/useFeatureMarkers";
import { SelectedFeatureContent } from "./SelectedFeatureContent";
import type { ResolvedFeatureContent } from "./resolveSelectedFeatureContent";

export interface SelectedFeatureSheetProps {
  content: ResolvedFeatureContent;
  selectedFeatureId: string;
  markerRoot?: ParentNode;
  locale: LocaleCode;
  onClose: () => void;
  onHeightChange: (height: number) => void;
}

export function SelectedFeatureSheet({
  content,
  selectedFeatureId,
  markerRoot,
  locale,
  onClose,
  onHeightChange,
}: SelectedFeatureSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<() => void>(() => {});

  const close = () => {
    focusFeatureMarker(selectedFeatureId, markerRoot ?? document);
    onClose();
  };
  closeRef.current = close;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height !== undefined) onHeightChange(height);
    });
    observer.observe(sheet);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  return (
    <aside ref={sheetRef} className="selected-feature-sheet" aria-label={content.name}>
      <div className="selected-feature-sheet__scroll">
        <SelectedFeatureContent
          content={content}
          locale={locale}
          onClose={close}
        />
      </div>
    </aside>
  );
}
