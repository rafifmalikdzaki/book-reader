/*
 * Replays saved model answers through the real renderer. Skipped unless OPENUI_REPLAY points at
 * JSON written by `scripts/eval_ask.py --live --save-answers FILE` (or a directory of them):
 *
 *   OPENUI_REPLAY=/tmp/answers npx vitest run src/features/chat-render/replay.test.tsx
 */
import { render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { parseOpenUIBlock } from "./legacyJson";
import { parseMarkdown } from "./markdown";
import { OpenUIBlockView } from "./OpenUIBlockView";

interface Record_ {
  case: string;
  provider: string;
  model: string;
  answer: string;
}

const target = process.env.OPENUI_REPLAY;

function load(path: string): { file: string; records: Record_[] }[] {
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((name) => name.endsWith(".json"))
        .map((name) => join(path, name))
    : [path];
  return files.map((file) => ({
    file,
    records: JSON.parse(readFileSync(file, "utf8")) as Record_[],
  }));
}

describe.skipIf(!target)("replay saved answers", () => {
  for (const { file, records } of target ? load(target) : []) {
    for (const record of records) {
      const blocks = parseMarkdown(record.answer ?? "").filter((block) => block.kind === "openui");
      it(`${file.split("/").pop()} · ${record.case} · ${blocks.length} block(s)`, () => {
        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
          if (block.kind !== "openui") continue;
          if (block.format === "json") {
            expect(parseOpenUIBlock(block.code, true).status).toBe("ready");
          } else {
            const { unmount } = render(
              <MemoryRouter>
                <OpenUIBlockView code={block.code} closed format="lang" />
              </MemoryRouter>,
            );
            expect(screen.queryByText("Part of this view could not be rendered")).toBeNull();
            expect(document.body.textContent?.trim()).not.toBe("");
            unmount();
          }
        }
      });
    }
  }
});
