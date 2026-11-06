import { describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { storageConsoleHtml } from "./console.ts";

function consoleEscape() {
  const script = [
    ...storageConsoleHtml().matchAll(/<script>([\s\S]*?)<\/script>/gu),
  ]
    .map((match) => match[1]!)
    .find((value) => value.includes("var state ="));
  if (!script) throw new Error("console script not found");
  const start = script.indexOf("function esc(s)");
  const end = script.indexOf("\n  function relTime", start);
  if (start < 0 || end <= start) throw new Error("esc seam not found");

  const context = createContext({
    document: {
      createElement() {
        let text = "";
        return {
          set textContent(value: string) {
            text = String(value);
          },
          get innerHTML() {
            return text
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;");
          },
        };
      },
    },
  });
  runInContext(script.slice(start, end) + ";globalThis.esc = esc;", context);
  return context.esc as (value: unknown) => string;
}

describe("console attribute escaping", () => {
  test("quoted filenames cannot break out of aria-label", () => {
    const esc = consoleEscape();
    const name = 'click-me" onclick="globalThis.__xss=1" x=".txt';
    const rendered = '<button aria-label="' + esc(name) + '"></button>';

    expect(rendered).toContain("&quot;");
    expect(rendered).not.toContain('onclick="globalThis.__xss=1"');
    expect(esc("<img src=x onerror=globalThis.__xss=1>.txt")).not.toContain(
      "<img",
    );
  });

  test("both attribute delimiters and markup are escaped together", () => {
    const esc = consoleEscape();
    expect(esc(`a&<b>"'`)).toBe("a&amp;&lt;b&gt;&quot;&#39;");
    expect(esc(`' onfocus='globalThis.__xss=1`)).toBe(
      "&#39; onfocus=&#39;globalThis.__xss=1",
    );
  });

  test("existing entities stay literal and ordinary filenames retain their text", () => {
    const esc = consoleEscape();
    expect(esc("&quot;&#39;&lt;")).toBe("&amp;quot;&amp;#39;&amp;lt;");
    expect(esc("日本語 😀 report.txt")).toBe("日本語 😀 report.txt");
    expect(esc(0)).toBe("0");
    expect(esc(false)).toBe("false");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});
