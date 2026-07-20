import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GdbImportDialog } from "./GdbImportDialog";
import type { GdbInspection, GdbMappingPlan } from "../gdb/types";

const inspection: GdbInspection = {
  sourceName: "Station.gdb",
  databases: [{ id: "gdb-1", name: "Station.gdb" }],
  layers: [
    { key: { databaseId: "gdb-1", layerName: "Station_1_Floor" }, databaseName: "Station.gdb", featureCount: 3, geometryFamily: "polygon", fields: [{ name: "id", type: "String" }] },
  ],
  warnings: [],
};

const plan: GdbMappingPlan = {
  venueName: "Station",
  buildings: [{ id: "b1", name: "Station" }],
  layers: [
    { key: { databaseId: "gdb-1", layerName: "Station_1_Floor" }, included: true, targetType: "level", buildingId: "b1", levelRule: { kind: "layer-name" }, idField: "id", ordinalField: null, shortNameField: null, nameField: null, categoryField: null },
  ],
};

describe("GdbImportDialog", () => {
  it("imports the plan when there are no blocking issues", () => {
    const onImport = vi.fn();
    render(<GdbImportDialog inspection={inspection} initialPlan={plan} locale="en" busy={false} error={null} onImport={onImport} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0]![0].layers[0].targetType).toBe("level");
  });

  it("disables import while a blocking issue exists", () => {
    const brokenPlan = { ...plan, layers: [{ ...plan.layers[0]!, buildingId: null }] };
    render(<GdbImportDialog inspection={inspection} initialPlan={brokenPlan} locale="en" busy={false} error={null} onImport={vi.fn()} onCancel={() => {}} />);
    expect((screen.getByRole("button", { name: /import/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("locks the venue name field when venueNameLocked is true", () => {
    render(
      <GdbImportDialog
        inspection={inspection}
        initialPlan={plan}
        locale="en"
        busy={false}
        error={null}
        venueNameLocked
        onImport={vi.fn()}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText(/venue name/i) as HTMLInputElement;
    // Prefer getByRole('textbox', { name: /venue name/i }) if label association works.
    expect(input.readOnly || input.disabled).toBe(true);
    expect(input.value).toBe("Station");
  });
});
