import type { LocaleCode } from "../imdf/types";
import type { LayerVisibility, MapLayerGroup } from "../map/layerGroups";
import { IconEye, IconEyeOff } from "./icons";

const GROUPS: MapLayerGroup[] = ["units", "openings", "fixtures", "amenities", "labels"];

const groupLabels: Record<MapLayerGroup, Record<LocaleCode, string>> = {
  units: { ja: "ユニット", en: "Units" },
  openings: { ja: "出入口", en: "Openings" },
  fixtures: { ja: "什器", en: "Fixtures" },
  amenities: { ja: "アメニティ", en: "Amenities" },
  labels: { ja: "ラベル", en: "Labels" },
};

const ui = {
  featureTypes: { ja: "地物タイプ", en: "Feature types" },
  shown: { ja: "表示中", en: "shown" },
  hidden: { ja: "非表示", en: "hidden" },
} as const;

export interface LayersPanelProps {
  locale: LocaleCode;
  visibility: LayerVisibility;
  onToggle: (group: MapLayerGroup) => void;
}

/**
 * Kiriko Layers panel body: feature-type visibility toggles with eye icons.
 * Hosted inside a FloatingPanel.
 */
export function LayersPanel({ locale, visibility, onToggle }: LayersPanelProps) {
  return (
    <div className="layers-panel">
      <h3 className="panel-caption">{ui.featureTypes[locale]}</h3>
      <ul className="layers-panel__list">
        {GROUPS.map((group) => {
          const visible = visibility[group];
          const label = groupLabels[group][locale];
          return (
            <li key={group}>
              <button
                type="button"
                className={visible ? "layer-toggle" : "layer-toggle layer-toggle--off"}
                aria-pressed={visible}
                aria-label={`${label}: ${visible ? ui.shown[locale] : ui.hidden[locale]}`}
                onClick={() => {
                  onToggle(group);
                }}
              >
                {visible ? <IconEye size={16} /> : <IconEyeOff size={16} />}
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
