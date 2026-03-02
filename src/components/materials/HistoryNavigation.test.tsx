import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryNavigation } from "@/components/materials/HistoryNavigation";

vi.mock("next/link", () => ({
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("HistoryNavigation", () => {
  it("shows the saved expressions navigation label", () => {
    render(<HistoryNavigation />);

    expect(screen.getByRole("link", { name: /保存した表現/ })).toHaveAttribute("href", "/expressions");
    expect(screen.queryByText("登録した表現")).not.toBeInTheDocument();
  });
});
