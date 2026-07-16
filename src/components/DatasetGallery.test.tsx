import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "../platform/types";
import { DatasetGallery } from "./DatasetGallery";

const ENTRIES: CatalogEntry[] = [
  {
    id: "shinjuku",
    name: "新宿駅",
    kind: "venue-snapshot",
    levelCount: 6,
    featureCount: 40941,
    sourceName: "NW_POI_20260625.gdb",
    updatedAt: "2026-07-10T09:00:00.000Z",
  },
  {
    id: "tokyo-imdf",
    name: "Tokyo Station",
    kind: "imdf",
    levelCount: 3,
    featureCount: 120,
    sourceName: "tokyo.zip",
    updatedAt: "2026-07-01T09:00:00.000Z",
  },
];

describe("DatasetGallery", () => {
  it("renders one card per entry with kind badge and counts", () => {
    render(<DatasetGallery entries={ENTRIES} locale="en" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /新宿駅/ })).toBeTruthy();
    expect(screen.getByText("GDB")).toBeTruthy();
    expect(screen.getByText("IMDF")).toBeTruthy();
    expect(screen.getByText(/6 levels \/ 40941 features/)).toBeTruthy();
  });

  it("reports the clicked dataset id", async () => {
    const onOpen = vi.fn();
    render(<DatasetGallery entries={ENTRIES} locale="ja" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /新宿駅/ }));
    expect(onOpen).toHaveBeenCalledWith("shinjuku");
  });

  it("shows the empty message without entries", () => {
    render(<DatasetGallery entries={[]} locale="en" onOpen={vi.fn()} />);
    expect(screen.getByText("No datasets have been published yet.")).toBeTruthy();
  });
});
