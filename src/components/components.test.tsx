import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewerLevel } from "../imdf/types";
import { SelectedFeatureContent } from "./SelectedFeatureContent";
import { ImdfDropzone } from "./ImdfDropzone";
import { LevelSwitcher } from "./LevelSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { GdbImportDialog } from "./GdbImportDialog";
import { suggestGdbMapping } from "../gdb/gdbMapping";
import { ArchiveError } from "../errors/ArchiveError";
import type {
  GdbGeometryFamily,
  GdbInspection,
  GdbLayerDescriptor,
  GdbLayerPlan,
  GdbMappingPlan,
} from "../gdb/types";

const LEVEL_2F: ViewerLevel = {
  id: "b1000003-0000-4000-8000-00000000002f",
  sourceLevelIds: ["b1000003-0000-4000-8000-00000000002f"],
  ordinal: 1,
  label: { ja: "2F", en: "2F" },
  shortName: { ja: "2F", en: "2F" },
};

const LEVEL_1F: ViewerLevel = {
  id: "b1000002-0000-4000-8000-00000000001f",
  sourceLevelIds: ["b1000002-0000-4000-8000-00000000001f"],
  ordinal: 0,
  label: { ja: "1F", en: "1F" },
  shortName: { ja: "1F", en: "1F" },
};

const LEVEL_B1: ViewerLevel = {
  id: "b1000001-0000-4000-8000-0000000000b1",
  sourceLevelIds: ["b1000001-0000-4000-8000-0000000000b1"],
  ordinal: -1,
  label: { ja: "B1", en: "B1" },
  shortName: { ja: "B1", en: "B1" },
};

/** Descending ordinal order as normalizeVenue produces. */
const LEVELS_DESC: ViewerLevel[] = [LEVEL_2F, LEVEL_1F, LEVEL_B1];

describe("LevelSwitcher", () => {
  it("renders levels in the given descending order with aria-pressed on the selected pill", () => {
    render(
      <LevelSwitcher
        levels={LEVELS_DESC}
        selectedLevelId={LEVEL_1F.id}
        locale="en"
        manifestLanguage="ja-JP"
        onSelect={() => {}}
      />,
    );

    const group = screen.getByRole("group", { name: "Levels" });
    const pills = within(group).getAllByRole("button");
    expect(pills.map((pill) => pill.textContent)).toEqual(["2F", "1F", "B1"]);
    expect(pills[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(pills[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(pills[2]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("changes selection on click and Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LevelSwitcher
        levels={LEVELS_DESC}
        selectedLevelId={LEVEL_1F.id}
        locale="en"
        manifestLanguage="ja-JP"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "2F" }));
    expect(onSelect).toHaveBeenCalledWith(LEVEL_2F.id);

    onSelect.mockClear();
    const b1 = screen.getByRole("button", { name: "B1" });
    b1.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(LEVEL_B1.id);
  });
});


describe("ThemeSwitcher", () => {
  it("updates aria-pressed when the selected theme changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <ThemeSwitcher themeId="tokyo-green" locale="en" onChange={onChange} />,
    );

    const green = screen.getByRole("button", { name: "Tokyo Green" });
    const blue = screen.getByRole("button", { name: "Customer Blue" });
    expect(green.getAttribute("aria-pressed")).toBe("true");
    expect(blue.getAttribute("aria-pressed")).toBe("false");

    await user.click(blue);
    expect(onChange).toHaveBeenCalledWith("customer-blue");

    rerender(<ThemeSwitcher themeId="customer-blue" locale="en" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Customer Blue" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Tokyo Green" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("SelectedFeatureContent", () => {
  const content = {
    name: "Station Shop",
    description: "A convenient station shop.",
    category: "shopping",
    floor: "1F",
    hours: "Daily 09:00-21:00",
    accessibility: ["wheelchair"],
    phone: "+81 3 1234 5678",
    website: "https://example.com",
    image: { src: "/station-shop.jpg", alt: "Station Shop storefront" },
    sourceAttributes: null,
    provenance: null,
  };

  it("renders visitor content and secure contact actions without diagnostics", () => {
    render(<SelectedFeatureContent content={content} locale="en" onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Station Shop" })).toBeTruthy();
    expect(screen.getByText("A convenient station shop.")).toBeTruthy();
    expect(screen.getByText("shopping")).toBeTruthy();
    expect(screen.getByText("1F")).toBeTruthy();
    expect(screen.getByText("Daily 09:00-21:00")).toBeTruthy();
    expect(screen.getByText("wheelchair")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Station Shop storefront" })).toBeTruthy();

    const phone = screen.getByRole("link", { name: "+81 3 1234 5678" });
    expect(phone.getAttribute("href")).toBe("tel:+81 3 1234 5678");
    const website = screen.getByRole("link", { name: "Website" });
    expect(website.getAttribute("href")).toBe("https://example.com");
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.getAttribute("rel")).toBe("noreferrer");

    expect(screen.queryByText("Type")).toBeNull();
    expect(screen.queryByText("ID")).toBeNull();
    expect(screen.queryByText("Restriction")).toBeNull();
  });

  it("omits missing rows and removes failed media without a placeholder", () => {
    const { rerender } = render(
      <SelectedFeatureContent
        content={{
          ...content,
          description: null,
          category: null,
          floor: null,
          hours: null,
          accessibility: [],
          phone: null,
          website: null,
        }}
        locale="en"
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("Description")).toBeNull();
    expect(screen.queryByText("Category")).toBeNull();
    expect(screen.queryByText("Floor")).toBeNull();
    expect(screen.queryByText("Hours")).toBeNull();
    expect(screen.queryByText("Accessibility")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();

    rerender(
      <SelectedFeatureContent
        content={{ ...content, image: { src: "/another.jpg", alt: "Another place" } }}
        locale="en"
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("img", { name: "Another place" })).toBeTruthy();
  });

  it("renders GDB source attributes instead of the IMDF summary", () => {
    render(
      <SelectedFeatureContent
        content={{
          ...content,
          sourceAttributes: [
            { field: "OBJECTID", value: "7" },
            { field: "名称", value: "コンコース" },
          ],
          provenance: "TokyoSta_B1_Space (gdb-1)",
        }}
        locale="en"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("TokyoSta_B1_Space (gdb-1)")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Source data" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "OBJECTID" })).toBeTruthy();
    expect(screen.getByText("コンコース")).toBeTruthy();
    expect(screen.queryByText("shopping")).toBeNull();
  });

  it("calls onClose from the localized close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <SelectedFeatureContent content={{ ...content, image: null }} locale="en" onClose={onClose} />,
    );
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <SelectedFeatureContent content={{ ...content, image: null }} locale="ja" onClose={onClose} />,
    );
    expect(screen.getByRole("button", { name: "詳細を閉じる" })).toBeTruthy();
  });
});


function dropzoneProps(
  overrides: Partial<ComponentProps<typeof ImdfDropzone>> = {},
): ComponentProps<typeof ImdfDropzone> {
  return {
    locale: "en",
    status: "empty",
    variant: "empty",
    onFiles: vi.fn(),
    onOpenPicker: vi.fn(),
    onOpenGdbArchives: vi.fn(),
    onOpenGdbFolder: vi.fn(),
    ...overrides,
  };
}

function gdbZipFile(name: string): File {
  return new File([new Uint8Array([0x50, 0x4b])], name, { type: "application/zip" });
}

function fireDrop(target: Element, files: File[]): void {
  fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
}

describe("ImdfDropzone", () => {
  it("opens the file picker when the empty-state button is activated with click, Enter, and Space", async () => {
    const user = userEvent.setup();
    const onOpenPicker = vi.fn();
    render(<ImdfDropzone {...dropzoneProps({ onOpenPicker })} />);

    const openBtn = screen.getByRole("button", { name: "Open IMDF ZIP" });
    await user.click(openBtn);
    expect(onOpenPicker).toHaveBeenCalledTimes(1);

    onOpenPicker.mockClear();
    openBtn.focus();
    await user.keyboard("{Enter}");
    expect(onOpenPicker).toHaveBeenCalledTimes(1);

    onOpenPicker.mockClear();
    openBtn.focus();
    await user.keyboard(" ");
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  it("exposes localized GDB archive and folder controls that call their callbacks", async () => {
    const user = userEvent.setup();
    const onOpenGdbArchives = vi.fn();
    const onOpenGdbFolder = vi.fn();
    const { rerender } = render(
      <ImdfDropzone {...dropzoneProps({ onOpenGdbArchives, onOpenGdbFolder })} />,
    );

    await user.click(screen.getByRole("button", { name: "Open GDB archive(s)" }));
    expect(onOpenGdbArchives).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Open GDB folder" }));
    expect(onOpenGdbFolder).toHaveBeenCalledTimes(1);

    rerender(<ImdfDropzone {...dropzoneProps({ locale: "ja" })} />);
    expect(screen.getByRole("button", { name: "GDB アーカイブを開く" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GDB フォルダを開く" })).toBeTruthy();
  });

  it("replaces the folder control with zip guidance when webkitdirectory is unsupported", () => {
    const { rerender } = render(<ImdfDropzone {...dropzoneProps({ gdbFolderSupported: false })} />);
    expect(screen.getByRole("button", { name: "Open GDB archive(s)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open GDB folder" })).toBeNull();
    expect(screen.getByText(/Zip each \.gdb and use Open GDB archive/i)).toBeTruthy();

    rerender(<ImdfDropzone {...dropzoneProps({ locale: "ja", gdbFolderSupported: false })} />);
    expect(screen.getByText(/各 \.gdb を ZIP 化/)).toBeTruthy();
  });

  it("routes a single IMDF zip and one-or-more .gdb.zip drops through onFiles, ignoring mixtures", () => {
    const onFiles = vi.fn();
    const { container } = render(<ImdfDropzone {...dropzoneProps({ onFiles })} />);
    const zone = container.querySelector(".imdf-dropzone")!;

    fireDrop(zone, [gdbZipFile("venue.zip")]);
    expect(onFiles).toHaveBeenLastCalledWith([expect.objectContaining({ name: "venue.zip" })]);

    onFiles.mockClear();
    fireDrop(zone, [gdbZipFile("a.gdb.zip"), gdbZipFile("b.gdb.zip")]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]![0]).toHaveLength(2);

    onFiles.mockClear();
    fireDrop(zone, [gdbZipFile("venue.zip"), gdbZipFile("extra.zip")]);
    expect(onFiles).not.toHaveBeenCalled();

    fireDrop(zone, [gdbZipFile("a.gdb.zip"), gdbZipFile("readme.txt")]);
    expect(onFiles).not.toHaveBeenCalled();
  });
});

function gdbLayer(
  layerName: string,
  geometryFamily: GdbGeometryFamily,
  featureCount: number,
  fieldNames: readonly string[] = [],
  databaseId = "gdb-1",
): GdbLayerDescriptor {
  return {
    key: { databaseId, layerName },
    databaseName: `${databaseId}.gdb`,
    featureCount,
    geometryFamily,
    fields: fieldNames.map((name) => ({ name, type: "String" })),
  };
}

function gdbInspection(layers: GdbLayerDescriptor[], warnings: string[] = []): GdbInspection {
  return {
    sourceName: "Venue.gdb",
    databases: [{ id: "gdb-1", name: "gdb-1.gdb" }],
    layers,
    warnings,
  };
}

/** A minimal inspection whose suggested plan is import-valid. */
function validSetup() {
  const inspection = gdbInspection([
    gdbLayer("Bldg_F1_Floor", "polygon", 3, ["id", "name"]),
  ]);
  return { inspection, plan: suggestGdbMapping(inspection) };
}

function renderDialog(
  overrides: Partial<ComponentProps<typeof GdbImportDialog>> = {},
) {
  const { inspection, plan } = validSetup();
  const props = {
    inspection,
    initialPlan: plan,
    locale: "en" as const,
    busy: false,
    error: null,
    onImport: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<GdbImportDialog {...props} />) };
}

describe("GdbImportDialog", () => {
  it("mounts at most 100 layer rows even for a large inspection", () => {
    const inspection = gdbInspection(
      Array.from({ length: 250 }, (_, i) => gdbLayer(`layer_${i}`, "polygon", 1)),
    );
    renderDialog({ inspection, initialPlan: suggestGdbMapping(inspection) });
    const table = screen.getByRole("table", { name: "Layers" });
    // One include checkbox per mounted data row.
    expect(within(table).getAllByRole("checkbox")).toHaveLength(100);
  });

  it("paginates to the next page of rows", async () => {
    const user = userEvent.setup();
    const inspection = gdbInspection(
      Array.from({ length: 150 }, (_, i) => gdbLayer(`layer_${i}`, "polygon", 1)),
    );
    renderDialog({ inspection, initialPlan: suggestGdbMapping(inspection) });
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Layers" });
    expect(within(table).getAllByRole("checkbox")).toHaveLength(50);
  });

  it("focuses the venue-name input on open", () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByLabelText("Venue name"));
  });

  it("disables the include checkbox for empty layers", () => {
    const inspection = gdbInspection([gdbLayer("Bldg_F1_Space", "polygon", 0)]);
    renderDialog({ inspection, initialPlan: suggestGdbMapping(inspection) });
    const box = screen.getByLabelText("Include Bldg_F1_Space") as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });

  it("enables Import for a valid plan and calls onImport with the edited plan", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    renderDialog({ onImport });
    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);

    const venue = screen.getByLabelText("Venue name");
    await user.clear(venue);
    await user.type(venue, "Edited Venue");
    await user.click(importBtn);

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ venueName: "Edited Venue" }),
    );
  });

  it("disables Import when an included level has no building", () => {
    const { inspection, plan } = validSetup();
    const invalid = {
      ...plan,
      layers: plan.layers.map((l) => ({ ...l, buildingId: null })),
    };
    renderDialog({ inspection, initialPlan: invalid });
    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  it("disables Import when an included row has an incompatible target type", () => {
    // A line layer forced to the polygon-only `level` target type.
    const inspection = gdbInspection([gdbLayer("Bldg_F1_edge", "line", 4)]);
    const plan = suggestGdbMapping(inspection);
    const invalid = {
      ...plan,
      layers: plan.layers.map((l) => ({
        ...l,
        included: true,
        targetType: "level" as const,
        buildingId: "building-1",
      })),
      buildings: [{ id: "building-1", name: "Bldg" }],
    };
    renderDialog({ inspection, initialPlan: invalid });
    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  it("disables Import while busy", () => {
    renderDialog({ busy: true });
    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  it("preserves manual edits when a recoverable error prop appears", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderDialog();
    const venue = screen.getByLabelText("Venue name");
    await user.clear(venue);
    await user.type(venue, "KeepMe");

    const err = new ArchiveError("gdb_conversion_failed", "boom");
    rerender(<GdbImportDialog {...props} error={err} />);

    expect((screen.getByLabelText("Venue name") as HTMLInputElement).value).toBe("KeepMe");
    expect(screen.getByRole("alert").textContent).toContain("could not be converted");
  });

  it("names the failing layer and gives guidance for a conversion error with details", () => {
    const { props, rerender } = renderDialog();
    const err = new ArchiveError("gdb_conversion_failed", "boom", {
      reason: "unresolved source-reference level",
      layer: "Free_shuttle_bus_busstop_Facility",
      feature: null,
      reference: null,
    });
    rerender(<GdbImportDialog {...props} error={err} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Free_shuttle_bus_busstop_Facility");
    // Actionable guidance: exclude the layer or adjust its mapping.
    expect(alert.textContent).toMatch(/exclude/i);
  });

  it("appends the worker's GDAL detail for an export failure", () => {
    const { props, rerender } = renderDialog();
    const err = new ArchiveError("gdb_conversion_failed", "boom", {
      layer: "Bldg_F1_Floor",
      database: "gdb-1",
      detail: "GDAL could not reproject the layer.",
    });
    rerender(<GdbImportDialog {...props} error={err} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Bldg_F1_Floor");
    expect(alert.textContent).toContain("GDAL could not reproject the layer.");
  });

  it("lists every failing layer when the error carries a failures array", () => {
    const { props, rerender } = renderDialog();
    const err = new ArchiveError("gdb_conversion_failed", "boom", {
      layer: "Free_shuttle_bus_busstop_Facility",
      reason: "unresolved source-reference level",
      failures: [
        { layer: "Free_shuttle_bus_busstop_Facility", reason: "unresolved source-reference level" },
        { layer: "Yaechika_B2_Space", reason: "incompatible GeometryCollection member family" },
        { layer: "Shinmarubiru_3_Space", reason: "incompatible feature geometry" },
      ],
    });
    rerender(<GdbImportDialog {...props} error={err} />);
    const alert = screen.getByRole("alert");
    const items = within(alert).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(alert.textContent).toContain("Free_shuttle_bus_busstop_Facility");
    expect(alert.textContent).toContain("Yaechika_B2_Space");
    expect(alert.textContent).toContain("Shinmarubiru_3_Space");
    // Header names the count and the exclude/fix guidance.
    expect(alert.textContent).toMatch(/3 layers/);
    expect(alert.textContent).toMatch(/exclude/i);
  });

  it("routes a native cancel (Escape) to onCancel", () => {
    const { props } = renderDialog();
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    fireEvent(dialog as HTMLElement, new Event("cancel", { cancelable: true }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });


  it("renders non-blocking inspection warnings", () => {
    const inspection = gdbInspection(
      [gdbLayer("Bldg_F1_Floor", "polygon", 3, ["id"])],
      ["Layer x had a projection note"],
    );
    renderDialog({ inspection, initialPlan: suggestGdbMapping(inspection) });
    expect(screen.getByText("Layer x had a projection note")).toBeTruthy();
  });

  it("summary counts only included layers and omits unmapped exclusions", () => {
    const inspection = gdbInspection([
      gdbLayer("Bldg_F1_Floor", "polygon", 3, ["id"]),
      gdbLayer("random_notes", "polygon", 12),
      gdbLayer("F1_to_F2_link", "line", 8),
    ]);
    const plan = suggestGdbMapping(inspection);
    // Floor included; unrecognized + cross-floor default excluded.
    expect(plan.layers.find((l) => l.key.layerName === "Bldg_F1_Floor")?.included).toBe(true);
    expect(plan.layers.find((l) => l.key.layerName === "random_notes")?.included).toBe(false);
    expect(plan.layers.find((l) => l.key.layerName === "F1_to_F2_link")?.included).toBe(false);

    renderDialog({ inspection, initialPlan: plan });
    expect(screen.getByText("Including 1 layers, 3 features")).toBeTruthy();
    // Unmapped rows remain visible for review but are not part of the import total.
    expect(screen.getByLabelText("Include random_notes")).toBeTruthy();
    expect((screen.getByLabelText("Include random_notes") as HTMLInputElement).checked).toBe(false);
  });

  it("clearing a fixed ordinal stores a non-finite value, stays empty, and blocks Import", async () => {
    const user = userEvent.setup();
    const inspection = gdbInspection([gdbLayer("edge", "line", 4)]);
    const initialPlan = {
      venueName: "V",
      buildings: [{ id: "building-1", name: "Bldg" }],
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "edge" },
          included: true,
          targetType: "detail" as const,
          buildingId: "building-1",
          levelRule: { kind: "fixed" as const, label: "B1", ordinal: -1 },
          idField: null,
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
      ],
    };
    renderDialog({ inspection, initialPlan });
    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);

    const ordinal = screen.getByLabelText("Ordinal edge") as HTMLInputElement;
    await user.clear(ordinal);

    expect(ordinal.value).toBe("");
    expect(importBtn.disabled).toBe(true);
  });

  it("blocks Import for an included level with a building but no resolvable ordinal source", () => {
    // R token is unresolvable and the layer has no fields/rule.
    const inspection = gdbInspection([gdbLayer("Station_R_level", "polygon", 3)]);
    const plan = suggestGdbMapping(inspection);
    const level = plan.layers[0]!;
    expect(level.targetType).toBe("level");
    expect(level.buildingId).toBe("building-1");
    expect(level.levelRule).toBeNull();
    renderDialog({ inspection, initialPlan: plan });
    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("resolvable ordinal");
  });

  it("ignores a building-prefix digit when validating a level ordinal", () => {
    // Prefix "2" must not resolve the floor; token R is unresolvable -> blocked.
    const blocked = gdbInspection([gdbLayer("Station_2_R_level", "polygon", 3)]);
    renderDialog({ inspection: blocked, initialPlan: suggestGdbMapping(blocked) });
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    cleanup();

    // Structured token 0 resolves even with a prefix digit -> importable.
    const ok = gdbInspection([gdbLayer("Station_2_0_level", "polygon", 3)]);
    renderDialog({ inspection: ok, initialPlan: suggestGdbMapping(ok) });
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("allows a non-level layer-name rule when the loose layer token resolves", () => {
    // Shinjuku-style Camera_1_nw: not STRUCTURED_NAME, but extractGdbFloorOrdinal
    // finds 1 — dialog must accept so conversion can resolve the same way.
    const inspection = gdbInspection([
      gdbLayer("Bldg_F1_Floor", "polygon", 3, ["id"]),
      gdbLayer("Camera_1_nw", "line", 5),
    ]);
    const initialPlan = {
      venueName: "V",
      buildings: [{ id: "building-1", name: "Bldg" }],
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "Bldg_F1_Floor" },
          included: true,
          targetType: "level" as const,
          buildingId: "building-1",
          levelRule: null,
          idField: "id",
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
        {
          key: { databaseId: "gdb-1", layerName: "Camera_1_nw" },
          included: true,
          targetType: "detail" as const,
          buildingId: "building-1",
          levelRule: { kind: "layer-name" as const },
          idField: null,
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
      ],
    };
    renderDialog({ inspection, initialPlan });
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("blocks a non-level layer-name rule when no floor token can be resolved", () => {
    // Tokenless name would pass with only a building under the old check, then
    // fail conversion — dialog must block with the unresolved-ordinal copy.
    const inspection = gdbInspection([
      gdbLayer("Bldg_F1_Floor", "polygon", 3, ["id"]),
      gdbLayer("random_notes", "line", 2),
    ]);
    const initialPlan = {
      venueName: "V",
      buildings: [{ id: "building-1", name: "Bldg" }],
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "Bldg_F1_Floor" },
          included: true,
          targetType: "level" as const,
          buildingId: "building-1",
          levelRule: null,
          idField: "id",
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
        {
          key: { databaseId: "gdb-1", layerName: "random_notes" },
          included: true,
          targetType: "detail" as const,
          buildingId: "building-1",
          levelRule: { kind: "layer-name" as const },
          idField: null,
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
      ],
    };
    renderDialog({ inspection, initialPlan });
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toContain("resolvable ordinal");
  });

  it("setRuleKind invents no defaults: fixed starts empty and blocks Import", async () => {
    const user = userEvent.setup();
    const inspection = gdbInspection([
      gdbLayer("Bldg_F1_Floor", "polygon", 3, ["id"]),
      gdbLayer("station_link", "line", 4, ["floor_id"]),
    ]);
    renderDialog({ inspection, initialPlan: suggestGdbMapping(inspection) });

    await user.selectOptions(screen.getByLabelText("Level rule station_link"), "fixed");
    expect((screen.getByLabelText("Label station_link") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Ordinal station_link") as HTMLInputElement).value).toBe("");
    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  it("labels blocking issues with the canonical database and layer name", () => {
    // Same layer name in two databases; both forced to an incompatible type.
    const inspection = gdbInspection([
      gdbLayer("edge", "line", 4, [], "gdb-1"),
      gdbLayer("edge", "line", 4, [], "gdb-2"),
    ]);
    const initialPlan = {
      venueName: "V",
      buildings: [{ id: "building-1", name: "Bldg" }],
      layers: inspection.layers.map((d) => ({
        key: d.key,
        included: true,
        targetType: "level" as const,
        buildingId: "building-1",
        levelRule: null,
        idField: null,
        ordinalField: null,
        shortNameField: null,
        nameField: null,
        categoryField: null,
      })),
    };
    renderDialog({ inspection, initialPlan });
    const alertText = screen.getByRole("alert").textContent ?? "";
    expect(alertText).toContain("gdb-1 / edge");
    expect(alertText).toContain("gdb-2 / edge");
  });

  it("gives each building delete button a localized aria-label, falling back to id", () => {
    const inspection = gdbInspection([gdbLayer("Bldg_F1_Floor", "polygon", 3, ["id"])]);
    const initialPlan = {
      venueName: "V",
      buildings: [
        { id: "building-1", name: "North Tower" },
        { id: "building-2", name: "" },
      ],
      layers: [] as GdbLayerPlan[],
    };
    renderDialog({ inspection, initialPlan });
    expect(screen.getByLabelText("Delete North Tower")).toBeTruthy();
    expect(screen.getByLabelText("Delete building-2")).toBeTruthy();
  });

  it("counts only included layers for building use and omits unused buildings on import", async () => {
    // Zero-feature A_F1_Floor is excluded but still seeds building A; B_F1_Floor
    // is the only included assignment. A must not block delete/import, and the
    // submitted plan must not declare a building with no included assignment.
    const user = userEvent.setup();
    const onImport = vi.fn();
    const inspection = gdbInspection([
      gdbLayer("A_F1_Floor", "polygon", 0),
      gdbLayer("B_F1_Floor", "polygon", 3, ["id"]),
    ]);
    const plan = suggestGdbMapping(inspection);
    expect(plan.buildings.map((b) => b.name)).toEqual(["A", "B"]);
    expect(plan.layers.find((l) => l.key.layerName === "A_F1_Floor")?.included).toBe(false);
    expect(plan.layers.find((l) => l.key.layerName === "B_F1_Floor")?.included).toBe(true);

    renderDialog({ inspection, initialPlan: plan, onImport });

    const deleteA = screen.getByLabelText("Delete A") as HTMLButtonElement;
    const deleteB = screen.getByLabelText("Delete B") as HTMLButtonElement;
    expect(deleteA.disabled).toBe(false);
    expect(deleteB.disabled).toBe(true);

    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);
    await user.click(importBtn);

    expect(onImport).toHaveBeenCalledTimes(1);
    const submitted = onImport.mock.calls[0]![0] as GdbMappingPlan;
    expect(submitted.buildings).toEqual([{ id: "building-2", name: "B" }]);
    expect(
      submitted.layers
        .filter((l) => l.included)
        .every((l) => l.buildingId === null || submitted.buildings.some((b) => b.id === l.buildingId)),
    ).toBe(true);
  });

  it("clears buildingId on delete so re-including cannot pass an unknown building", async () => {
    // Uncheck structured A, delete building A, re-check A: the stale deleted id
    // must not remain selected/valid, or Import enables a plan the builder rejects.
    const user = userEvent.setup();
    const onImport = vi.fn();
    const inspection = gdbInspection([
      gdbLayer("A_F1_Floor", "polygon", 3, ["id"]),
      gdbLayer("B_F1_Floor", "polygon", 3, ["id"]),
    ]);
    const plan = suggestGdbMapping(inspection);
    expect(plan.buildings.map((b) => b.name)).toEqual(["A", "B"]);

    renderDialog({ inspection, initialPlan: plan, onImport });

    await user.click(screen.getByLabelText("Include A_F1_Floor"));
    expect((screen.getByLabelText("Include A_F1_Floor") as HTMLInputElement).checked).toBe(false);

    const deleteA = screen.getByLabelText("Delete A") as HTMLButtonElement;
    expect(deleteA.disabled).toBe(false);
    await user.click(deleteA);
    expect(screen.queryByLabelText("Delete A")).toBeNull();

    await user.click(screen.getByLabelText("Include A_F1_Floor"));
    const buildingSelect = screen.getByLabelText("Building A_F1_Floor") as HTMLSelectElement;
    expect(buildingSelect.value).toBe("");
    expect([...buildingSelect.options].map((o) => o.value)).toEqual(["", "building-2"]);

    const importBtn = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/assign a building/i);
    expect(onImport).not.toHaveBeenCalled();
  });
});
