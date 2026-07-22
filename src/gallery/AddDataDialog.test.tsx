import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddDataDialog } from "./AddDataDialog";
import type { NetworkInspectResponse } from "../gdb/types";

const network: NetworkInspectResponse = {
  networkBlobHash: "n".repeat(64),
  nodeCount: 120,
  edgeCount: 340,
  floors: ["1F", "2F"],
};

const baseProps = {
  locale: "en" as const,
  venueName: "Tokyo Station",
  network: null,
  facilities: null,
  busy: false,
  error: null,
  onAddNetwork: vi.fn(),
  onAddFacilities: vi.fn(),
  onImport: vi.fn(),
  onCancel: vi.fn(),
};

describe("AddDataDialog", () => {
  it("renders titled for adding routing/facilities and shows the venue name", () => {
    render(<AddDataDialog {...baseProps} venueName="Tokyo Station" />);
    expect(screen.getByRole("heading", { name: "Add routing / facilities" })).toBeTruthy();
    expect(screen.getByText("Tokyo Station")).toBeTruthy();
  });

  it("uploading a network archive calls onAddNetwork", async () => {
    const onAddNetwork = vi.fn();
    const user = userEvent.setup();
    render(<AddDataDialog {...baseProps} onAddNetwork={onAddNetwork} />);
    await user.upload(
      screen.getByLabelText("Add routing network"),
      new File([new Uint8Array([1, 2])], "net.gdb.zip", { type: "application/zip" }),
    );
    expect(onAddNetwork).toHaveBeenCalledTimes(1);
  });

  it("disables Add until data is attached, then enables and submits", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<AddDataDialog {...baseProps} onImport={onImport} />);
    const addBefore = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(addBefore.disabled).toBe(true);

    rerender(<AddDataDialog {...baseProps} network={network} onImport={onImport} />);
    expect(screen.getByText(/120 nodes/)).toBeTruthy();
    const addAfter = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(addAfter.disabled).toBe(false);
    await user.click(addAfter);
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
