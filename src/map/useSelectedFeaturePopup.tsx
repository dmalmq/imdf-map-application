import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Popup, type Map as MapLibreMap } from "maplibre-gl";
import { SelectedFeatureContent } from "../components/SelectedFeatureContent";
import { resolveSelectedFeatureContent } from "../components/resolveSelectedFeatureContent";
import type { LoadedVenue, LocaleCode } from "../imdf/types";
import { focusFeatureMarker } from "./useFeatureMarkers";

export interface UseSelectedFeaturePopupArgs {
  map: MapLibreMap | null;
  venue: LoadedVenue;
  selectedFeatureId: string | null;
  locale: LocaleCode;
  compact: boolean;
  onClose: () => void;
}

export function useSelectedFeaturePopup({
  map,
  venue,
  selectedFeatureId,
  locale,
  compact,
  onClose,
}: UseSelectedFeaturePopupArgs): void {
  useEffect(() => {
    if (map === null || compact || selectedFeatureId === null) return;
    const feature = venue.featuresById.get(selectedFeatureId);
    if (feature?.center == null) return;

    const container = document.createElement("div");
    container.className = "selected-feature-popup";
    container.addEventListener("click", (event) => event.stopPropagation());
    container.addEventListener("pointerdown", (event) => event.stopPropagation());
    const root = createRoot(container);
    const popup = new Popup({
      closeButton: false,
      closeOnClick: true,
      focusAfterOpen: false,
      maxWidth: "360px",
      offset: 14,
    });
    let dispatched = false;
    let cleaning = false;
    const dispatchClose = () => {
      if (dispatched || cleaning) return;
      dispatched = true;
      focusFeatureMarker(selectedFeatureId, map.getCanvasContainer());
      onClose();
    };

    root.render(
      <SelectedFeatureContent
        content={resolveSelectedFeatureContent(venue, feature, locale)}
        locale={locale}
        onClose={() => {
          if (dispatched) return;
          dispatched = true;
          popup.remove();
          focusFeatureMarker(selectedFeatureId, map.getCanvasContainer());
          onClose();
        }}
      />,
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Topmost-first: an open search dropdown or menu owns this Escape.
      if (document.querySelector(".floating-search__dropdown, .viewer-menu__panel")) return;
      popup.remove();
    };
    document.addEventListener("keydown", onKeyDown);
    popup.on("close", dispatchClose);
    popup.setLngLat(feature.center).setDOMContent(container).addTo(map);

    return () => {
      cleaning = true;
      document.removeEventListener("keydown", onKeyDown);
      root.unmount();
      popup.remove();
    };
  }, [compact, locale, map, onClose, selectedFeatureId, venue]);
}
