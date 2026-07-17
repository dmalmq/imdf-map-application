import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureType, LocaleCode } from "../imdf/types";

const ui = {
  button: { ja: "レイヤー", en: "Layers" },
  panel: { ja: "レイヤー表示", en: "Layers" },
  types: { ja: "地物種別", en: "Feature types" },
  buildings: { ja: "建物", en: "Buildings" },
  showAll: { ja: "すべて表示", en: "Show all" },
  hideAll: { ja: "すべて非表示", en: "Hide all" },
} as const;

const TYPE_LABELS: Record<string, { ja: string; en: string }> = {
  unit: { ja: "ユニット", en: "Units" },
  opening: { ja: "開口部", en: "Openings" },
  detail: { ja: "ディテール", en: "Details" },
  amenity: { ja: "アメニティ", en: "Amenities" },
  fixture: { ja: "什器", en: "Fixtures" },
  kiosk: { ja: "キオスク", en: "Kiosks" },
  occupant: { ja: "テナント", en: "Occupants" },
};

export interface LayerTypeRow {
  featureType: FeatureType;
  count: number;
}
export interface LayerBuildingRow {
  id: string;
  label: string;
  count: number;
}
export interface LayerControlsProps {
  locale: LocaleCode;
  types: LayerTypeRow[];
  buildings: LayerBuildingRow[];
  hiddenTypes: ReadonlySet<FeatureType>;
  hiddenBuildings: ReadonlySet<string>;
  onToggleType: (featureType: FeatureType) => void;
  onToggleBuilding: (buildingId: string) => void;
  onSetTypesHidden: (hidden: FeatureType[]) => void;
  onSetBuildingsHidden: (hidden: string[]) => void;
  onOpenChange: (open: boolean) => void;
}

function typeLabel(featureType: FeatureType, locale: LocaleCode): string {
  const entry = TYPE_LABELS[featureType];
  return entry ? entry[locale] : featureType;
}

export function LayerControls({
  locale,
  types,
  buildings,
  hiddenTypes,
  hiddenBuildings,
  onToggleType,
  onToggleBuilding,
  onSetTypesHidden,
  onSetBuildingsHidden,
  onOpenChange,
}: LayerControlsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocPointer = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpenState(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpenState(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpenState]);

  const anyHidden = hiddenTypes.size > 0 || hiddenBuildings.size > 0;
  const showBuildings = buildings.length >= 2;

  return (
    <div className="layer-controls" ref={rootRef}>
      <button
        type="button"
        className={
          anyHidden ? "layer-controls__btn layer-controls__btn--active" : "layer-controls__btn"
        }
        aria-expanded={open}
        aria-pressed={anyHidden}
        onClick={() => setOpenState(!open)}
      >
        {ui.button[locale]}
      </button>
      {open ? (
        <div className="layer-controls__panel" role="group" aria-label={ui.panel[locale]}>
          <section className="layer-controls__section" role="group" aria-label={ui.types[locale]}>
            <header className="layer-controls__header">
              <span>{ui.types[locale]}</span>
              <span className="layer-controls__bulk">
                <button type="button" onClick={() => onSetTypesHidden([])}>
                  {ui.showAll[locale]}
                </button>
                <button
                  type="button"
                  onClick={() => onSetTypesHidden(types.map((row) => row.featureType))}
                >
                  {ui.hideAll[locale]}
                </button>
              </span>
            </header>
            <ul className="layer-controls__list">
              {types.map((row) => (
                <li key={row.featureType}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!hiddenTypes.has(row.featureType)}
                      onChange={() => onToggleType(row.featureType)}
                    />
                    {`${typeLabel(row.featureType, locale)} (${row.count})`}
                  </label>
                </li>
              ))}
            </ul>
          </section>
          {showBuildings ? (
            <section
              className="layer-controls__section"
              role="group"
              aria-label={ui.buildings[locale]}
            >
              <header className="layer-controls__header">
                <span>{ui.buildings[locale]}</span>
                <span className="layer-controls__bulk">
                  <button type="button" onClick={() => onSetBuildingsHidden([])}>
                    {ui.showAll[locale]}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetBuildingsHidden(buildings.map((row) => row.id))}
                  >
                    {ui.hideAll[locale]}
                  </button>
                </span>
              </header>
              <ul className="layer-controls__list">
                {buildings.map((row) => (
                  <li key={row.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!hiddenBuildings.has(row.id)}
                        onChange={() => onToggleBuilding(row.id)}
                      />
                      {`${row.label} (${row.count})`}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
