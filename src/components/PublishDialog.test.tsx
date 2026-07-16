import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedVenue } from "../imdf/types";
import type * as catalogClientModule from "../platform/catalogClient";
import type { CatalogEntry } from "../platform/types";
import { PublishDialog } from "./PublishDialog";

const publishDatasetMock = vi.fn();
const writeVenueSnapshotMock = vi.fn(async (..._args: unknown[]) => new Blob(["snap"]));

vi.mock("../platform/catalogClient", async (importOriginal) => {
  const actual = await importOriginal<typeof catalogClientModule>();
  return {
    ...actual,
    publishDataset: (...args: unknown[]) => publishDatasetMock(...args),
  };
});

vi.mock("../imdf/venueSnapshot", () => ({
  writeVenueSnapshot: (...args: unknown[]) => writeVenueSnapshotMock(...args),
}));

function venueStub(): LoadedVenue {
  return {
    manifest: { version: "1.0.0", language: "ja" },
    venue: {} as LoadedVenue["venue"],
    levels: [{} as LoadedVenue["levels"][number], {} as LoadedVenue["levels"][number]],
    featuresById: new Map([
      ["a", {} as never],
      ["b", {} as never],
      ["c", {} as never],
    ]),
    renderFeaturesByLevel: new Map(),
    searchEntries: [],
    boundsByLevel: new Map(),
    enrichmentByFeatureId: new Map(),
    warnings: [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PublishDialog", () => {
  it("prefills a slug id, warns on overwrite, and publishes a snapshot", async () => {
    publishDatasetMock.mockResolvedValue({ id: "tokyo-station" });
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="Tokyo Station"
        sourceName="JRTokyoSta.gdb"
        kind="venue-snapshot"
        imdfFile={null}
        existingIds={["tokyo-station"]}
        locale="en"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    const idInput = screen.getByLabelText("Dataset ID") as HTMLInputElement;
    expect(idInput.value).toBe("tokyo-station");
    expect(screen.getByText(/will replace the existing dataset/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(publishDatasetMock).toHaveBeenCalledTimes(1);
    });
    const [meta, blob] = publishDatasetMock.mock.calls[0] as [Record<string, unknown>, Blob];
    expect(meta).toMatchObject({
      id: "tokyo-station",
      name: "Tokyo Station",
      kind: "venue-snapshot",
      levelCount: 2,
      featureCount: 3,
      sourceName: "JRTokyoSta.gdb",
    });
    expect(writeVenueSnapshotMock).toHaveBeenCalledTimes(1);
    expect(blob).toBeInstanceOf(Blob);
    // Success view exposes copyable view/embed URLs.
    expect((screen.getByLabelText("View URL") as HTMLInputElement).value).toContain(
      "dataset=tokyo-station",
    );
    expect((screen.getByLabelText("Embed URL") as HTMLInputElement).value).toContain("embed=1");
  });

  it("uploads the retained original file for IMDF datasets", async () => {
    publishDatasetMock.mockResolvedValue({ id: "minimal" });
    const original = new File(["zip-bytes"], "minimal.zip", { type: "application/zip" });
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="Minimal"
        sourceName="minimal.zip"
        kind="imdf"
        imdfFile={original}
        existingIds={[]}
        locale="en"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(publishDatasetMock).toHaveBeenCalledTimes(1);
    });
    expect(writeVenueSnapshotMock).not.toHaveBeenCalled();
    expect((publishDatasetMock.mock.calls[0] as unknown[])[1]).toBe(original);
  });

  it("surfaces server errors verbatim and keeps the form editable", async () => {
    publishDatasetMock.mockRejectedValue(new Error("Publishing requires an admin account."));
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="X"
        sourceName="x.gdb"
        kind="venue-snapshot"
        imdfFile={null}
        existingIds={[]}
        locale="en"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Publishing requires an admin account.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("closes via the Close button and the native cancel (Escape) event", async () => {
    const onClose = vi.fn();
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="X"
        sourceName="x.gdb"
        kind="venue-snapshot"
        imdfFile={null}
        existingIds={[]}
        locale="en"
        onClose={onClose}
        onPublished={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    fireEvent(dialog as HTMLElement, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(publishDatasetMock).not.toHaveBeenCalled();
  });

  it("ignores a publish that settles after Close was clicked", async () => {
    const pending = Promise.withResolvers<CatalogEntry>();
    publishDatasetMock.mockReturnValue(pending.promise);
    const onClose = vi.fn();
    const onPublished = vi.fn();
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="Tokyo Station"
        sourceName="JRTokyoSta.gdb"
        kind="venue-snapshot"
        imdfFile={null}
        existingIds={[]}
        locale="en"
        onClose={onClose}
        onPublished={onPublished}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(publishDatasetMock).toHaveBeenCalledTimes(1);
    });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    pending.resolve({
      id: "tokyo-station",
      name: "Tokyo Station",
      kind: "venue-snapshot",
      levelCount: 2,
      featureCount: 3,
      sourceName: "JRTokyoSta.gdb",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
    // The stale completion must not flip to the success view or re-notify.
    expect(onPublished).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("View URL")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("ignores a publish that settles after unmount", async () => {
    const pending = Promise.withResolvers<CatalogEntry>();
    publishDatasetMock.mockReturnValue(pending.promise);
    const onPublished = vi.fn();
    const { unmount } = render(
      <PublishDialog
        venue={venueStub()}
        defaultName="Minimal"
        sourceName="minimal.zip"
        kind="venue-snapshot"
        imdfFile={null}
        existingIds={[]}
        locale="en"
        onClose={vi.fn()}
        onPublished={onPublished}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(publishDatasetMock).toHaveBeenCalledTimes(1);
    });
    unmount();
    pending.resolve({
      id: "minimal",
      name: "Minimal",
      kind: "venue-snapshot",
      levelCount: 2,
      featureCount: 3,
      sourceName: "minimal.zip",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
    expect(onPublished).not.toHaveBeenCalled();
  });
});
