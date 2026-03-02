import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialLearningScreen } from "@/components/materials/MaterialLearningScreen";

const fetchMock = vi.fn();
const seekToMsMock = vi.fn();
const playMock = vi.fn();
const scrollIntoViewMock = vi.fn();

vi.mock("@/components/materials/YouTubeIFramePlayer", () => ({
  YouTubeIFramePlayer: ({
    onApiReady,
    onTimeChange,
  }: {
    onApiReady?: (api: { seekToMs: (ms: number) => void; play: () => void }) => void;
    onTimeChange?: (ms: number) => void;
  }) => {
    React.useEffect(() => {
      onApiReady?.({ seekToMs: seekToMsMock, play: playMock });
    }, [onApiReady]);
    return (
      <div data-testid="youtube-player">
        player
        <button type="button" onClick={() => onTimeChange?.(3500)}>
          advance-time
        </button>
      </div>
    );
  },
}));

describe("Learning screen integration", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    seekToMsMock.mockReset();
    playMock.mockReset();
    scrollIntoViewMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(scrollIntoViewMock);
  });

  it("shows ready material with video and subtitles", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              youtubeId: "dQw4w9WgXcQ",
              status: "ready",
              pipelineVersion: "v1",
            },
            status: "ready",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: [{ segmentId: "s1", startMs: 1000, endMs: 2000, text: "take ownership now" }],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("字幕")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /\[1\.0s\].*take ownership now.*選択中/ })).toBeInTheDocument();
    });
  });

  it("shows empty states when subtitles are unavailable", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              youtubeId: "dQw4w9WgXcQ",
              status: "processing",
              pipelineVersion: "v1",
            },
            status: "processing",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: [],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("字幕がまだありません")).toBeInTheDocument();
      expect(screen.getByText("一覧から字幕をタップすると、その位置から動画を再生できます。")).toBeInTheDocument();
    });
  });

  it("keeps subtitle selection in sync with the playback controls", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              youtubeId: "dQw4w9WgXcQ",
              status: "ready",
              pipelineVersion: "v1",
            },
            status: "ready",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: [
              { segmentId: "s1", startMs: 1000, endMs: 2000, text: "first subtitle" },
              { segmentId: "s2", startMs: 3000, endMs: 4000, text: "second subtitle" },
            ],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /\[3\.0s\].*second subtitle/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /\[3\.0s\].*second subtitle/ }));

    await waitFor(() => {
      expect(screen.getByText("選択中の字幕")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /\[3\.0s\].*second subtitle.*選択中/ })).toBeInTheDocument();
    });
  });

  it("does not force-scroll the page when playback advances", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              youtubeId: "dQw4w9WgXcQ",
              status: "ready",
              pipelineVersion: "v1",
            },
            status: "ready",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: [
              { segmentId: "s1", startMs: 1000, endMs: 2000, text: "first subtitle" },
              { segmentId: "s2", startMs: 3000, endMs: 4000, text: "second subtitle" },
            ],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "advance-time" })).toBeInTheDocument();
    });

    scrollIntoViewMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "advance-time" }));

    await waitFor(() => {
      expect(screen.getByText("再生位置: 3.5s")).toBeInTheDocument();
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("saves expressions, shows matching scenes, and deletes them", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (!init?.method || init.method === "GET") {
        if (url.endsWith("/api/materials/mat1")) {
          return {
            ok: true,
            json: async () => ({
              material: {
                materialId: "mat1",
                youtubeId: "dQw4w9WgXcQ",
                status: "ready",
                pipelineVersion: "v1",
              },
              status: "ready",
            }),
          };
        }

        if (url.endsWith("/api/materials/mat1/segments")) {
          return {
            ok: true,
            json: async () => ({
              segments: [
                { segmentId: "s1", startMs: 1000, endMs: 2000, text: "take ownership now" },
                { segmentId: "s2", startMs: 3000, endMs: 4000, text: "we take ownership every day" },
              ],
            }),
          };
        }

        if (url.endsWith("/api/materials/mat1/expressions")) {
          return {
            ok: true,
            json: async () => ({
              expressions: [
                {
                  expressionId: "exp-1",
                  expression: "take ownership",
                  meaning: "責任を持つ",
                  exampleSentence: "We should take ownership of the result.",
                },
              ],
            }),
          };
        }
      }

      if (url.endsWith("/api/materials/mat1/expressions") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            expression: {
              expressionId: "exp-2",
              expression: "every day",
              meaning: "毎日",
              exampleSentence: "I study English every day.",
            },
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/expressions/exp-1") && init?.method === "DELETE") {
        return {
          ok: true,
          status: 204,
          json: async () => null,
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("保存された表現")).toBeInTheDocument();
      expect(screen.getByText("take ownership")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /\[1\.0s\].*take ownership now/ })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: /\[3\.0s\].*we take ownership every day/ })).toHaveLength(2);
    });

    scrollIntoViewMock.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: /\[1\.0s\].*take ownership now/ })[1]!);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(seekToMsMock).toHaveBeenCalledWith(1000);
    expect(playMock).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("保存する表現"), { target: { value: "every day" } });
    fireEvent.change(screen.getByLabelText("意味"), { target: { value: "毎日" } });
    fireEvent.change(screen.getByLabelText("例文"), { target: { value: "I study English every day." } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("I study English every day.")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /\[3\.0s\].*we take ownership every day/ })).toHaveLength(3);
      expect(screen.getByLabelText("保存する表現")).not.toHaveAttribute("placeholder");
      expect(screen.getByLabelText("意味")).not.toHaveAttribute("placeholder");
      expect(screen.getByLabelText("例文")).not.toHaveAttribute("placeholder");
    });

    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]!);

    await waitFor(() => {
      expect(screen.queryByText("We should take ownership of the result.")).not.toBeInTheDocument();
    });
  }, 10000);

  it("hides and deletes saved expressions that have blank text fields", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (!init?.method || init.method === "GET") {
        if (url.endsWith("/api/materials/mat1")) {
          return {
            ok: true,
            json: async () => ({
              material: {
                materialId: "mat1",
                youtubeId: "dQw4w9WgXcQ",
                status: "ready",
                pipelineVersion: "v1",
              },
              status: "ready",
            }),
          };
        }

        if (url.endsWith("/api/materials/mat1/segments")) {
          return {
            ok: true,
            json: async () => ({
              segments: [{ segmentId: "s1", startMs: 1000, endMs: 2000, text: "take ownership now" }],
            }),
          };
        }

        if (url.endsWith("/api/materials/mat1/expressions")) {
          return {
            ok: true,
            json: async () => ({
              expressions: [
                {
                  expressionId: "exp-bad",
                  expression: "",
                  meaning: "責任を持つ",
                  exampleSentence: "",
                },
              ],
            }),
          };
        }
      }

      if (url.endsWith("/api/materials/mat1/expressions/exp-bad") && init?.method === "DELETE") {
        return {
          ok: true,
          status: 204,
          json: async () => null,
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("保存された表現")).toBeInTheDocument();
      expect(screen.getByText("まだ表現は保存されていません")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/materials/mat1/expressions/exp-bad", { method: "DELETE" });
    });
  });
});
