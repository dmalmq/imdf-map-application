import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewerMenu } from "./ViewerMenu";

const baseProps = {
  venueName: "Test Station",
  floorName: "First Floor",
  locale: "en" as const,
  themeId: "tokyo-green" as const,
  showFileControls: true,
  onLocaleChange: () => {},
  onThemeChange: () => {},
  onOpenFile: () => {},
  onOpenChange: () => {},
};

describe("ViewerMenu", () => {
  it("opens localized venue, floor, locale, and theme controls", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ViewerMenu {...baseProps} />);
    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("dialog", { name: "Viewer menu" });
    expect(within(menu).getByText("Test Station")).toBeTruthy();
    expect(menu.querySelector(".viewer-menu__meta span")?.textContent).toBe("First Floor");
    expect(within(menu).getByRole("button", { name: "English" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Customer Blue" })).toBeTruthy();

    rerender(<ViewerMenu {...baseProps} locale="ja" />);
    expect(screen.getByRole("button", { name: "メニュー" })).toBeTruthy();
  });

  it("shows standalone file controls, omits them in embed, and allows host opt-in", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const { rerender } = render(<ViewerMenu {...baseProps} onOpenFile={onOpenFile} />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Open IMDF ZIP" }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);

    rerender(<ViewerMenu {...baseProps} showFileControls={false} onOpenFile={onOpenFile} />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.queryByRole("button", { name: "Open IMDF ZIP" })).toBeNull();

    rerender(<ViewerMenu {...baseProps} showFileControls onOpenFile={onOpenFile} />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("button", { name: "Open IMDF ZIP" })).toBeTruthy();
  });

  it("closes on Escape and outside click, restores focus, and reports opening", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ViewerMenu {...baseProps} onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Menu" });

    await user.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
