import type { LocaleCode } from "../imdf/types";
import { IconCrosshair, IconMinus, IconPlus } from "./icons";

const ui = {
  group: { ja: "ズーム", en: "Zoom" },
  zoomIn: { ja: "拡大", en: "Zoom in" },
  zoomOut: { ja: "縮小", en: "Zoom out" },
  recenter: { ja: "フロア全体を表示", en: "Fit floor" },
} as const;

export interface ZoomClusterProps {
  locale: LocaleCode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
}

/** Kiriko ZoomCluster: floating +/− and fit-floor controls, bottom-right. */
export function ZoomCluster({ locale, onZoomIn, onZoomOut, onRecenter }: ZoomClusterProps) {
  return (
    <div className="zoom-cluster" role="group" aria-label={ui.group[locale]}>
      <button type="button" className="zoom-cluster__btn" aria-label={ui.zoomIn[locale]} onClick={onZoomIn}>
        <IconPlus />
      </button>
      <button type="button" className="zoom-cluster__btn" aria-label={ui.zoomOut[locale]} onClick={onZoomOut}>
        <IconMinus />
      </button>
      <button
        type="button"
        className="zoom-cluster__btn"
        aria-label={ui.recenter[locale]}
        onClick={onRecenter}
      >
        <IconCrosshair />
      </button>
    </div>
  );
}
