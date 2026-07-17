import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const createVenue = vi.fn();
const uploadVersion = vi.fn();
const waitForJob = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createVenue: (...a: unknown[]) => createVenue(...a),
      uploadVersion: (...a: unknown[]) => uploadVersion(...a),
      waitForJob: (...a: unknown[]) => waitForJob(...a),
    },
  };
});

import { UploadModal } from "./UploadModal";

afterEach(() => {
  vi.clearAllMocks();
});

function zipFile(name = "shinjuku-station.zip"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, { type: "application/zip" });
}

describe("UploadModal", () => {
  it("prefills the name from the file, uploads, and reaches the done state", async () => {
    createVenue.mockResolvedValue({ id: 7, slug: "shinjuku-station", name: "shinjuku-station" });
    uploadVersion.mockResolvedValue({ jobId: "j1" });
    waitForJob.mockResolvedValue({ status: "done" });
    const onPublished = vi.fn();
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={onPublished} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile());
    expect((screen.getByLabelText("Dataset name") as HTMLInputElement).value).toBe(
      "shinjuku-station",
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(screen.getByText("Published")).toBeTruthy();
    });
    expect(createVenue).toHaveBeenCalledWith("shinjuku-station");
    expect(uploadVersion).toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalled();
    const open = screen.getByRole("link", { name: "Open" });
    expect(open.getAttribute("href")).toBe("/?dataset=shinjuku-station");
  });

  it("surfaces a failed publish job and re-enables the form", async () => {
    createVenue.mockResolvedValue({ id: 8, slug: "bad", name: "bad" });
    uploadVersion.mockResolvedValue({ jobId: "j2" });
    waitForJob.mockResolvedValue({ status: "error", error: "not a ZIP archive" });
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("bad.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText(/not a ZIP archive/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });
});
