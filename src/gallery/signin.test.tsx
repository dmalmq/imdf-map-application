import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";

const login = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, login: (...a: unknown[]) => login(...a) } };
});

import { SignInModal } from "./SignInModal";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SignInModal", () => {
  it("submits credentials and reports success", async () => {
    login.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
    const onSignedIn = vi.fn();
    const user = userEvent.setup();
    render(<SignInModal locale="en" onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("Username"), "daniel");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalled();
    });
    expect(login).toHaveBeenCalledWith("daniel", "secret");
  });

  it("shows the error line on 401 and keeps the form usable", async () => {
    login.mockRejectedValue(new ApiError(401, "invalid_credentials"));
    const user = userEvent.setup();
    render(<SignInModal locale="en" onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("Username"), "daniel");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Wrong username or password.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
