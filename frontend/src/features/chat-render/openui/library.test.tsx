import { Renderer } from "@openuidev/react-lang";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { OpenUIBlockView } from "../OpenUIBlockView";
import { openuiLibrary, openuiPromptOptions } from "./library";

// vitest runs from frontend/, the committed prompt lives in the Python package.
const PROMPT = readFileSync(
  resolve(process.cwd(), "../src/book_reader/prompts/openui_prompt.txt"),
  "utf8",
);
const EXAMPLES = openuiPromptOptions.examples ?? [];

function lang(code: string, { closed = true, onPrompt = vi.fn() } = {}) {
  return render(
    <MemoryRouter>
      <OpenUIBlockView code={code} closed={closed} format="lang" onPrompt={onPrompt} />
    </MemoryRouter>,
  );
}

describe("OpenUI Lang library", () => {
  it("has examples to check", () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  it("keeps the committed prompt in sync with the library (run npm run gen:openui-prompt)", () => {
    for (const name of Object.keys(openuiLibrary.components)) {
      expect(PROMPT).toContain(`${name}(`);
    }
    for (const example of EXAMPLES) {
      expect(PROMPT).toContain(example);
    }
  });

  it.each(EXAMPLES.map((example, index) => [index, example] as const))(
    "prompt example %i renders without errors",
    (_index, example) => {
      const onError = vi.fn();
      const { container } = render(
        <MemoryRouter>
          <Renderer library={openuiLibrary} response={example} isStreaming={false} onError={onError} />
        </MemoryRouter>,
      );
      expect(onError.mock.calls.flat(2)).toEqual([]);
      expect(container.textContent?.trim()).not.toBe("");
    },
  );

  it("renders several blocks from one program, in order", () => {
    lang(
      [
        "root = Answer([card, chart])",
        'card = ConceptCard("Self-attention")',
        'chart = Chart("Latency", [{label: "A", value: 85}, {label: "B", value: 24}])',
      ].join("\n"),
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Self-attention");
    expect(text).toContain("Latency");
    expect(text.indexOf("Self-attention")).toBeLessThan(text.indexOf("Latency"));
  });

  it("renders a half-streamed program progressively", () => {
    lang('root = Answer([card])\ncard = ConceptCard("Self-att', { closed: false });
    expect(document.body.textContent).toContain("Self-att");
  });

  it("shows a placeholder before any code has streamed in", () => {
    lang("", { closed: false });
    expect(screen.getByRole("status").textContent).toContain("Building");
  });

  it("falls back to the raw program when a closed block cannot render", () => {
    const code = "root = Answer([x])\nx = Nope(1)";
    lang(code);
    const summary = screen.getByText("Part of this view could not be rendered");
    expect(summary).toBeTruthy();
    expect(document.body.textContent).toContain(code.split("\n")[1]);
  });

  it("does not show the fallback while a block is still streaming", () => {
    lang("root = Answer([x])\nx = Nope(1)", { closed: false });
    expect(screen.queryByText("Part of this view could not be rendered")).toBeNull();
  });

  it("QuizCheck sends the chosen option through the prompt context", () => {
    const onPrompt = vi.fn();
    lang('root = Answer([q])\nq = QuizCheck("Why?", ["A", "B"])', { onPrompt });
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt.mock.calls[0]?.[0]).toBe("A");
  });

  it("still renders legacy JSON blocks stored before the migration", () => {
    render(
      <MemoryRouter>
        <OpenUIBlockView
          code='{"component":"ConceptCard","title":"Legacy card"}'
          closed
          format="json"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Legacy card")).toBeTruthy();
  });
});
