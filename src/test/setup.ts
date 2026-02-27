import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});
