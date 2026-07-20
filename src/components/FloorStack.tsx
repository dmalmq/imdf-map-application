import { localizedLabel } from "../imdf/localize";
import type { LocaleCode, ViewerLevel } from "../imdf/types";
import { groupLevelsByOrdinal, ordinalOfLevel, type FloorGroup } from "../state/floorGroups";

const ui = {
  group: { ja: "フロア", en: "Levels" },
} as const;

export interface FloorStackProps {
  levels: ViewerLevel[];
  selectedLevelId: string;
  locale: LocaleCode;
  manifestLanguage: string;
  onSelect: (levelId: string) => void;
}

/** Short floor label ("1F", "B1") for a group; falls back to the full label. */
function shortLabelForGroup(
  group: FloorGroup,
  locale: LocaleCode,
  manifestLanguage: string,
): string {
  const short = localizedLabel(group.shortName, locale, "", manifestLanguage);
  if (short !== "") {
    return short;
  }
  return localizedLabel(group.label, locale, group.representativeLevelId, manifestLanguage);
}

/**
 * Kiriko FloorStack: floating vertical stack of floor buttons on the map's
 * right edge; the active floor is an Ai Indigo fill.
 */
export function FloorStack({
  levels,
  selectedLevelId,
  locale,
  manifestLanguage,
  onSelect,
}: FloorStackProps) {
  const groups = groupLevelsByOrdinal(levels);
  const selectedOrdinal = ordinalOfLevel(levels, selectedLevelId);
  return (
    <div className="floor-stack" role="group" aria-label={ui.group[locale]}>
      {groups.map((group) => {
        const selected = group.ordinal === selectedOrdinal;
        const label = shortLabelForGroup(group, locale, manifestLanguage);
        const full = localizedLabel(group.label, locale, group.representativeLevelId, manifestLanguage);
        return (
          <button
            key={group.representativeLevelId}
            type="button"
            className={selected ? "floor-stack__btn floor-stack__btn--active" : "floor-stack__btn"}
            aria-pressed={selected}
            aria-label={full}
            title={full}
            onClick={() => {
              onSelect(group.representativeLevelId);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
