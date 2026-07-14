import { useEffect, useRef } from "react";
import type { LocaleCode } from "../imdf/types";
import { SelectedFeatureContent } from "./SelectedFeatureContent";
import type { ResolvedFeatureContent } from "./resolveSelectedFeatureContent";

export interface SelectedFeatureSheetProps {
  content: ResolvedFeatureContent;
  locale: LocaleCode;
  onClose: () => void;
  onHeightChange: (height: number) => void;
}

export function SelectedFeatureSheet({
  content,
  locale,
  onClose,
  onHeightChange,
}: SelectedFeatureSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

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
        <SelectedFeatureContent content={content} locale={locale} onClose={onClose} />
      </div>
    </aside>
  );
}
