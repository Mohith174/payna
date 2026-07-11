import { describe, expect, it } from "vitest";
import { UnparseableResponseError, extractFirstJsonArray } from "./parse.js";

describe("extractFirstJsonArray", () => {
  it("parses a bare JSON array", () => {
    expect(extractFirstJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("ignores a <think> reasoning block before the array", () => {
    const raw = '<think>Let me look for [requirements] here...</think>\n[{"name":"x"}]';
    expect(extractFirstJsonArray(raw)).toEqual([{ name: "x" }]);
  });

  it("extracts an array from inside a markdown fence with prose around it", () => {
    const raw = 'Here are the results:\n```json\n[{"name":"Annual Report"}]\n```\nDone.';
    expect(extractFirstJsonArray(raw)).toEqual([{ name: "Annual Report" }]);
  });

  it("is not fooled by brackets inside string values", () => {
    const raw = '[{"description":"see [section 3] of the code"}]';
    expect(extractFirstJsonArray(raw)).toEqual([{ description: "see [section 3] of the code" }]);
  });

  it("skips a prose bracket pair and finds the real array after it", () => {
    const raw = "As noted [1], the filings are:\n[{\"name\":\"Bond\"}]";
    expect(extractFirstJsonArray(raw)).toEqual([{ name: "Bond" }]);
  });

  it("throws UnparseableResponseError when no array exists", () => {
    expect(() => extractFirstJsonArray("I could not find any requirements.")).toThrow(UnparseableResponseError);
  });
});
