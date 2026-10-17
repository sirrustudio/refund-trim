// The script reports the page's edge colours for the safe-area strips. The
// page isn't trusted, so only plain rgb() and rgba() values get through.
import { parseLiteColor, parseLiteMessage } from "@/utils/lite-inject";

describe("parseLiteColor", () => {
  it("reads rgb() and rgba() as the browser writes them", () => {
    expect(parseLiteColor("rgb(12, 16, 20)")).toEqual({ r: 12, g: 16, b: 20 });
    expect(parseLiteColor("rgba(255, 255, 255, 0.9)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });

  it("refuses anything else", () => {
    expect(parseLiteColor("red")).toBeNull();
    expect(parseLiteColor("#000000")).toBeNull();
    expect(parseLiteColor("rgb(256, 0, 0)")).toBeNull();
    expect(parseLiteColor("rgb(0, 0, 0); position: absolute")).toBeNull();
    expect(parseLiteColor("url(https://example.com)")).toBeNull();
    expect(parseLiteColor(42)).toBeNull();
    expect(parseLiteColor(undefined)).toBeNull();
  });
});

describe("the colours message", () => {
  it("passes when both colours are good", () => {
    const raw = JSON.stringify({
      type: "colors",
      top: "rgb(255, 255, 255)",
      bottom: "rgb(0, 0, 0)",
    });
    expect(parseLiteMessage(raw)).toEqual({
      type: "colors",
      top: { r: 255, g: 255, b: 255 },
      bottom: { r: 0, g: 0, b: 0 },
    });
  });

  it("is dropped when either colour is bad or missing", () => {
    expect(
      parseLiteMessage(
        JSON.stringify({ type: "colors", top: "rgb(0, 0, 0)", bottom: "blue" }),
      ),
    ).toBeNull();
    expect(
      parseLiteMessage(JSON.stringify({ type: "colors", top: "rgb(0, 0, 0)" })),
    ).toBeNull();
  });
});
