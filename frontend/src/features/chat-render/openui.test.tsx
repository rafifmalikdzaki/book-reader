import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { OpenUIBlockView } from "./OpenUIBlockView";
import { parseOpenUIBlock, type OpenUISpec } from "./legacyJson";

function parseReady(raw: unknown): OpenUISpec {
  const parsed = parseOpenUIBlock(
    typeof raw === "string" ? raw : JSON.stringify(raw),
  );
  if (parsed.status !== "ready")
    throw new Error(`expected ready, got ${parsed.status}`);
  return parsed.spec;
}

function view(spec: unknown, onPrompt?: (prompt: string) => void) {
  return render(
    <MemoryRouter>
      <OpenUIBlockView code={JSON.stringify(spec)} onPrompt={onPrompt} />
    </MemoryRouter>,
  );
}

function barWidths(container: HTMLElement): number[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[style*="width"]'),
  ).map((el) => Number.parseInt(el.style.width, 10));
}

describe("parseOpenUIBlock", () => {
  const minimal: Record<string, unknown> = {
    SkillMap: { skills: [{ name: "A", level: 2 }] },
    ConceptCard: { title: "T", intuition: "i" },
    ComparisonTable: { columns: ["a", "b"], rows: [["1", "2"]] },
    StepWalkthrough: { steps: [{ title: "s", detail: "d" }] },
    BookList: { books: [{ book: "a.pdf", why: "w" }] },
    QuizCheck: { question: "q?" },
    ConceptGraph: { nodes: [{ id: "a", label: "A" }] },
    Chart: { items: [{ label: "x", value: 1 }] },
  };

  it.each(Object.keys(minimal))("accepts a minimal %s", (component) => {
    const spec = parseReady({ component, ...(minimal[component] as object) });
    expect(spec.component).toBe(component);
  });

  it.each([
    ["Graph", "ConceptGraph", minimal.ConceptGraph],
    ["Architecture", "ConceptGraph", minimal.ConceptGraph],
    ["BarChart", "Chart", minimal.Chart],
    ["MetricChart", "Chart", minimal.Chart],
  ])("normalizes the %s alias to %s", (alias, canonical, body) => {
    expect(
      parseReady({ component: alias, ...(body as object) }).component,
    ).toBe(canonical);
  });

  it("reads documented field aliases", () => {
    const card = parseReady({
      component: "ConceptCard",
      name: "N",
      summary: "S",
      math: "M",
    });
    expect(card).toMatchObject({ title: "N", intuition: "S", formal: "M" });
    const chart = parseReady({
      component: "Chart",
      bars: [{ name: "a", score: 3 }],
    });
    expect(chart).toMatchObject({ items: [{ label: "a", value: 3 }] });
  });

  it("clamps skill levels into 0..5 and drops unknown statuses", () => {
    const spec = parseReady({
      component: "SkillMap",
      skills: [
        { name: "hi", level: 99, status: "done" },
        { name: "lo", level: -4, status: "bogus" },
        { name: "nan", level: "x" },
      ],
    });
    if (spec.component !== "SkillMap") throw new Error("wrong component");
    expect(spec.skills.map((s) => [s.level, s.status])).toEqual([
      [5, "done"],
      [0, undefined],
      [0, undefined],
    ]);
  });

  it("rejects specs that would render empty", () => {
    for (const body of [
      { component: "ConceptCard" },
      { component: "ComparisonTable" },
      { component: "StepWalkthrough", steps: [] },
      { component: "BookList", books: [] },
      { component: "QuizCheck" },
      { component: "ConceptGraph", nodes: [] },
      { component: "Chart", items: [] },
      { component: "Nope" },
      [],
    ]) {
      expect(parseOpenUIBlock(JSON.stringify(body)).status).toBe("invalid");
    }
  });

  it("reports a half-streamed block with its component name", () => {
    expect(
      parseOpenUIBlock('{"component": "Chart", "title": "Sp', false),
    ).toEqual({
      status: "streaming",
      component: "Chart",
    });
    expect(parseOpenUIBlock("", false)).toEqual({ status: "streaming" });
    expect(parseOpenUIBlock('{"component": "Chart", "title": "Sp').status).toBe(
      "invalid",
    );
  });

  it("repairs trailing commas and bare LaTeX backslashes", () => {
    const spec = parseReady(
      '{"component":"ConceptCard","title":"T","formal":"\\frac{a}{b} \\forall x",}',
    );
    expect(spec).toMatchObject({ formal: "\\frac{a}{b} \\forall x" });
  });

  it('does not rewrite ", ]" inside string values while repairing', () => {
    const spec = parseReady(
      '{"component":"ConceptCard","title":"pairs, ]","intuition":"x",}',
    );
    expect(spec).toMatchObject({ title: "pairs, ]" });
  });
});

describe("OpenUIBlockView", () => {
  it("falls back to the raw code for unknown components", () => {
    const { container } = view({ component: "Nope" });
    expect(container.querySelector("pre code")?.textContent).toContain("Nope");
  });

  it("QuizCheck: toggles the hint and sends the chosen option once per click", () => {
    const onPrompt = vi.fn();
    view(
      {
        component: "QuizCheck",
        question: "Why?",
        hint: "Think softmax",
        options: ["A", "B"],
      },
      onPrompt,
    );

    expect(screen.queryByText(/Think softmax/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Need a hint?" }));
    expect(screen.getByText(/Think softmax/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide hint" }));
    expect(screen.queryByText(/Think softmax/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(onPrompt).toHaveBeenCalledExactlyOnceWith("B");
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("QuizCheck: shows no answer buttons when there is no prompt handler", () => {
    view({ component: "QuizCheck", question: "Why?", options: ["A"] });
    expect(screen.queryByRole("button", { name: "A" })).toBeNull();
  });

  it('StepWalkthrough: renders every step and "Unpack step" prompts for that step', () => {
    const onPrompt = vi.fn();
    view(
      {
        component: "StepWalkthrough",
        title: "Derive",
        steps: [
          { title: "First", detail: "one" },
          { title: "Second", detail: "two" },
        ],
      },
      onPrompt,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    const unpack = screen.getAllByRole("button", { name: /Unpack step/ });
    expect(unpack).toHaveLength(2);
    fireEvent.click(unpack[1]!);
    expect(onPrompt).toHaveBeenCalledOnce();
    expect(onPrompt.mock.calls[0]![0]).toContain("Second");
  });

  it("ConceptGraph: selects a node into the inspector and offers a follow-up prompt", () => {
    const onPrompt = vi.fn();
    view(
      {
        component: "ConceptGraph",
        title: "Flow",
        nodes: [
          { id: "a", label: "Alpha", detail: "first detail" },
          { id: "b", label: "Beta", detail: "second detail" },
        ],
        edges: [{ from: "a", to: "b", label: "feeds" }],
      },
      onPrompt,
    );
    expect(screen.getByText("first detail")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Select concept node Beta" }),
    );
    expect(screen.getByText("second detail")).toBeInTheDocument();
    expect(screen.getByText("feeds")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Explore Beta/ }));
    expect(onPrompt).toHaveBeenCalledWith(
      "Explain Beta in the context of Flow",
    );
  });

  it("ConceptGraph: survives cycles, self-loops, dangling edges and duplicate ids", () => {
    const { container } = view({
      component: "ConceptGraph",
      title: "Messy",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "a", label: "A again" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
        { from: "a", to: "a" },
        { from: "a", to: "ghost" },
      ],
    });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(
      screen.getAllByRole("button", { name: /Select concept node/ }).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("Chart: uses displayValue, else value plus unit, and scales bars to the largest value", () => {
    const { container } = view({
      component: "Chart",
      title: "Speed",
      unit: "ms",
      items: [
        { label: "Fast", value: 20 },
        { label: "Slow", value: 80, displayValue: "80 ms (p99)" },
      ],
    });
    expect(screen.getByText("20 ms")).toBeInTheDocument();
    expect(screen.getByText("80 ms (p99)")).toBeInTheDocument();
    expect(barWidths(container)).toEqual([25, 100]);
  });

  it("Chart: scales fractional metrics relative to each other, not to 1", () => {
    const { container } = view({
      component: "Chart",
      title: "Error rate",
      items: [
        { label: "A", value: 0.01 },
        { label: "B", value: 0.04 },
      ],
    });
    expect(barWidths(container)).toEqual([25, 100]);
  });

  it("Chart: marks negative values so they are not drawn like their positive twin", () => {
    const { container } = view({
      component: "Chart",
      title: "Delta",
      items: [
        { label: "Up", value: 10 },
        { label: "Down", value: -10 },
      ],
    });
    const marked = container.querySelectorAll('[data-negative="true"]');
    expect(marked).toHaveLength(1);
    expect(screen.getByText("-10")).toBeInTheDocument();
  });

  it('BookList: "Inspect outline" asks for the chapter outline', () => {
    const onPrompt = vi.fn();
    view(
      {
        component: "BookList",
        books: [
          { book: "shelf/ml.pdf", title: "ML", why: "fits", start: "p.3" },
        ],
      },
      onPrompt,
    );
    fireEvent.click(screen.getByRole("button", { name: /Inspect outline/ }));
    expect(onPrompt).toHaveBeenCalledOnce();
    expect(onPrompt.mock.calls[0]![0]).toContain("outline");
  });
});
