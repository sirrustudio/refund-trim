/**
 * Coming back to Trim after a while reloads the page, so new messages and
 * notes show, unless a text field has focus and a draft would be lost.
 */
import { RELOAD_UNLESS_TYPING } from "@/utils/lite-inject";

function runWithFocusOn(activeElement: unknown) {
  const location = { reload: jest.fn() };
  new Function("document", "location", RELOAD_UNLESS_TYPING)(
    { activeElement },
    location,
  );
  return location.reload;
}

it("reloads when nothing has focus", () => {
  expect(runWithFocusOn(null)).toHaveBeenCalledTimes(1);
  expect(runWithFocusOn({ tagName: "BODY" })).toHaveBeenCalledTimes(1);
});

it.each([
  ["a text input", { tagName: "INPUT" }],
  ["a textarea", { tagName: "TEXTAREA" }],
  ["an editable div", { tagName: "DIV", isContentEditable: true }],
])("waits while %s has focus", (_name, field) => {
  expect(runWithFocusOn(field)).not.toHaveBeenCalled();
});
