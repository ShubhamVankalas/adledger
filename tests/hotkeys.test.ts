import { describe, expect, it } from "vitest";
import { fuzzyScore } from "@/lib/fuzzy";
import { createMatcher, hotkeyKeycaps, hotkeyText, isTypingTarget, matchesStep, parseHotkey, SEQUENCE_TIMEOUT_MS, type KeyEventLike } from "@/lib/hotkeys";

const key = (k: string, mods: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe("parseHotkey", () => {
  it("parses sequences, modifiers and named keys", () => {
    expect(parseHotkey("g o")).toEqual([
      { key: "g", mod: false, shift: false, alt: false },
      { key: "o", mod: false, shift: false, alt: false },
    ]);
    expect(parseHotkey("mod+K")).toEqual([{ key: "k", mod: true, shift: false, alt: false }]);
    expect(parseHotkey("Shift+Alt+x")).toEqual([{ key: "x", mod: false, shift: true, alt: true }]);
    expect(parseHotkey("esc")).toEqual([{ key: "escape", mod: false, shift: false, alt: false }]);
    expect(parseHotkey("mod++")).toEqual([{ key: "+", mod: true, shift: false, alt: false }]);
    expect(parseHotkey("?")[0].key).toBe("?");
  });

  it("rejects empty strings and unknown modifiers", () => {
    expect(() => parseHotkey("  ")).toThrow();
    expect(() => parseHotkey("hyper+k")).toThrow(/Unknown modifier/);
  });
});

describe("matchesStep", () => {
  it("accepts ⌘ or Ctrl for mod and requires it", () => {
    const [step] = parseHotkey("mod+k");
    expect(matchesStep(step, key("k", { metaKey: true }))).toBe(true);
    expect(matchesStep(step, key("k", { ctrlKey: true }))).toBe(true);
    expect(matchesStep(step, key("K", { ctrlKey: true }))).toBe(true);
    expect(matchesStep(step, key("k"))).toBe(false);
  });

  it("keeps letters strict about Shift and modifiers", () => {
    const [x] = parseHotkey("x");
    expect(matchesStep(x, key("x"))).toBe(true);
    expect(matchesStep(x, key("X", { shiftKey: true }))).toBe(false);
    expect(matchesStep(x, key("x", { ctrlKey: true }))).toBe(false);
    const [shiftX] = parseHotkey("shift+x");
    expect(matchesStep(shiftX, key("X", { shiftKey: true }))).toBe(true);
  });

  it("matches symbols by the character typed, whatever Shift took", () => {
    const [q] = parseHotkey("?");
    expect(matchesStep(q, key("?", { shiftKey: true }))).toBe(true);
    const [bracket] = parseHotkey("shift+[");
    expect(matchesStep(bracket, key("{", { shiftKey: true }))).toBe(true);
    expect(matchesStep(bracket, key("["))).toBe(false);
    const [slash] = parseHotkey("/");
    expect(matchesStep(slash, key("/"))).toBe(true);
  });
});

describe("createMatcher (sequences)", () => {
  const defs = [
    { id: "go.overview", steps: parseHotkey("g o") },
    { id: "go.performance", steps: parseHotkey("g p") },
    { id: "palette", steps: parseHotkey("mod+k") },
    { id: "help", steps: parseHotkey("?") },
  ];

  it("fires a two-key sequence typed within a second", () => {
    const m = createMatcher(() => defs);
    expect(m.press(key("g"), 0)).toEqual({ match: null, waiting: true });
    expect(m.press(key("p"), 400)).toEqual({ match: "go.performance", waiting: false });
  });

  it("drops the sequence after the timeout", () => {
    const m = createMatcher(() => defs);
    m.press(key("g"), 0);
    expect(m.press(key("o"), SEQUENCE_TIMEOUT_MS + 1)).toEqual({ match: null, waiting: false });
  });

  it("treats a wrong second key on its own", () => {
    const m = createMatcher(() => defs);
    m.press(key("g"), 0);
    expect(m.press(key("?", { shiftKey: true }), 100)).toEqual({ match: "help", waiting: false });
    // …and the prefix is gone.
    expect(m.press(key("o"), 200)).toEqual({ match: null, waiting: false });
  });

  it("restarts a sequence when the prefix is pressed again", () => {
    const m = createMatcher(() => defs);
    m.press(key("g"), 0);
    expect(m.press(key("g"), 100)).toEqual({ match: null, waiting: true });
    expect(m.press(key("o"), 200).match).toBe("go.overview");
  });

  it("fires single keys and modifier chords directly", () => {
    const m = createMatcher(() => defs);
    expect(m.press(key("k", { metaKey: true }), 0).match).toBe("palette");
    expect(m.press(key("z"), 10)).toEqual({ match: null, waiting: false });
  });

  it("does not start a sequence on Shift+G", () => {
    const m = createMatcher(() => defs);
    expect(m.press(key("G", { shiftKey: true }), 0)).toEqual({ match: null, waiting: false });
  });
});

describe("isTypingTarget", () => {
  const el = (matches: string | null, editable = false) => ({ isContentEditable: editable, closest: (sel: string) => (matches && sel.includes(matches) ? {} : null) }) as unknown as EventTarget;
  it("ignores inputs, editable content, menus and dialogs", () => {
    expect(isTypingTarget(el("input"))).toBe(true);
    expect(isTypingTarget(el("[role='menu']"))).toBe(true);
    expect(isTypingTarget(el("[role='dialog']"))).toBe(true);
    expect(isTypingTarget(el(null, true))).toBe(true);
    expect(isTypingTarget(el(null))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("display", () => {
  it("renders keycaps per platform", () => {
    expect(hotkeyKeycaps("mod+k", true)).toEqual([["⌘", "K"]]);
    expect(hotkeyKeycaps("mod+k", false)).toEqual([["Ctrl", "K"]]);
    expect(hotkeyKeycaps("g o", false)).toEqual([["G"], ["O"]]);
    expect(hotkeyKeycaps("esc", false)).toEqual([["Esc"]]);
    expect(hotkeyText("g o", false)).toBe("G then O");
    expect(hotkeyText("mod+k", false)).toBe("Ctrl K");
    expect(hotkeyText("mod+k", true)).toBe("⌘K");
  });
});

describe("fuzzyScore", () => {
  it("matches words, keywords and loose subsequences, and rejects non-matches", () => {
    expect(fuzzyScore("integ", "Integrations")).toBeGreaterThan(0);
    expect(fuzzyScore("pixel", "Tracking & forms", ["pixel", "snippet"])).toBeGreaterThan(0);
    expect(fuzzyScore("intgr", "Integrations")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "Integrations")).toBe(0);
    expect(fuzzyScore("linear", "Attribution model: Linear")).toBeGreaterThan(0);
    expect(fuzzyScore("", "Anything")).toBeGreaterThan(0);
  });

  it("ranks exact over prefix over word start over substring", () => {
    const exact = fuzzyScore("ads", "Ads");
    const prefix = fuzzyScore("ad", "Ad sets");
    const wordStart = fuzzyScore("sets", "Ad sets");
    const inside = fuzzyScore("ets", "Ad sets");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(fuzzyScore("ad", "Ads")).toBeGreaterThan(fuzzyScore("ad", "Ad sets"));
    // Label hits beat keyword-only hits.
    expect(fuzzyScore("members", "Members & roles")).toBeGreaterThan(fuzzyScore("members", "Invite teammate", ["add member"]));
  });

  it("ignores case and accents", () => {
    expect(fuzzyScore("CAFE", "Café visitors")).toBeGreaterThan(0);
  });
});
