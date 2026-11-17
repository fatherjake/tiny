import { always, next, now } from "@antithesishq/bombadil";
import {
  type ActionTemplate,
  actions,
  extract,
  getFingerprint,
  weighted,
} from "@antithesishq/bombadil/browser";
import { lastAction } from "@antithesishq/bombadil/browser/defaults/actions";

export { waitOnce } from "@antithesishq/bombadil/browser/defaults/actions";

export {
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties";

type Field = "none" | "price" | "size" | "text" | "away";

type View = {
  ready: boolean;
  type: string[];
  side: string[];
  hasPrice: boolean;
  price: string | null;
  usd: string | null;
  orderSize: string | null;
  submit: string | null;
  text: string;
  field: Field;
};

const view = extract((state): View => {
  const doc = state.document;
  const form = doc.querySelector("form.pad");
  const empty: View = {
    ready: false,
    type: [],
    side: [],
    hasPrice: false,
    price: null,
    usd: null,
    orderSize: null,
    submit: null,
    text: "",
    field: "none",
  };
  if (!form) return empty;
  const groups = form.querySelectorAll(".group");
  const on = (group: Element | undefined) =>
    group
      ? [...group.querySelectorAll("button.on")].map(
          (button) =>
            [...button.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent ?? "")
              .join("")
              .trim()
              .split(" ")[0],
        )
      : [];
  const rowValue = (label: string): Element | null => {
    for (const row of form.querySelectorAll(".row")) {
      const first = row.querySelector("span");
      if (first?.textContent === label) return row;
    }
    return null;
  };
  const priceInput = rowValue("price (USD)")?.querySelector("input") ?? null;
  const usdInput = rowValue("size (USD)")?.querySelector("input") ?? null;
  const sizeRow = rowValue("order size");
  const active = doc.activeElement;
  let field: Field = "none";
  if (active === priceInput && priceInput) field = "price";
  else if (active === usdInput && usdInput) field = "size";
  else if (
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable) ||
    (active instanceof HTMLInputElement &&
      !["checkbox", "radio", "button", "submit"].includes(active.type))
  )
    field = form.contains(active) ? "text" : "away";
  return {
    ready: true,
    type: on(groups[0]),
    side: on(groups[1]),
    hasPrice: priceInput != null,
    price: priceInput?.value ?? null,
    usd: usdInput?.value ?? null,
    orderSize: sizeRow?.querySelectorAll("span")[1]?.textContent ?? null,
    submit:
      form.querySelector("button[type=submit]")?.textContent?.trim() ?? null,
    text: form.textContent ?? "",
    field,
  };
});

const KEY = {
  enter: 13,
  escape: 27,
  backspace: 8,
  tab: 9,
  b: 66,
  l: 76,
  m: 77,
  p: 80,
  s: 83,
} as const;

const pressed = (code: number) => {
  const action = lastAction.current;
  return (
    typeof action === "object" &&
    action !== null &&
    "PressKey" in action &&
    action.PressKey.code === code
  );
};

const pressedDigit = (): string | null => {
  const action = lastAction.current;
  if (typeof action !== "object" || action === null) return null;
  if (!("PressKey" in action)) return null;
  const code = action.PressKey.code;
  return code >= 48 && code <= 57 ? String(code - 48) : null;
};

const SCALED = /^\d+(\.\d{1,6})?$/;

export const formRenders = always(
  () => view.current.ready && view.current.submit != null,
);

export const oneOrderType = always(
  () => !view.current.ready || view.current.type.length === 1,
);

export const oneSide = always(
  () => !view.current.ready || view.current.side.length === 1,
);

export const priceOnlyForLimit = always(
  () =>
    !view.current.ready ||
    view.current.hasPrice === (view.current.type[0] === "limit"),
);

export const noBrokenText = always(
  () => !/NaN|undefined|null|Infinity|\[object/.test(view.current.text),
);

export const invalidSizeHasNoOrder = always(
  () =>
    view.current.usd == null ||
    SCALED.test(view.current.usd.trim()) ||
    (view.current.orderSize ?? "").trim().startsWith("-"),
);

export const submitLabelKnown = always(
  () =>
    view.current.submit == null ||
    view.current.submit.endsWith("Place Order") ||
    view.current.submit.endsWith("Sending Order"),
);

const outsideField = now(() => view.current.field === "none");

export const shortcutM = always(
  outsideField.implies(
    next(() => !pressed(KEY.m) || view.current.type[0] === "market"),
  ),
);

export const shortcutL = always(
  outsideField.implies(
    next(() => !pressed(KEY.l) || view.current.type[0] === "limit"),
  ),
);

export const shortcutB = always(
  outsideField.implies(
    next(() => !pressed(KEY.b) || view.current.side[0] === "buy"),
  ),
);

export const shortcutS = always(
  outsideField.implies(
    next(() => !pressed(KEY.s) || view.current.side[0] === "sell"),
  ),
);

export const shortcutP = always(
  outsideField.implies(
    next(
      () =>
        !pressed(KEY.p) ||
        (view.current.type[0] === "limit" && view.current.field === "price"),
    ),
  ),
);

export const shortcutDigit = always(
  outsideField.implies(
    next(() => {
      const digit = pressedDigit();
      return (
        digit == null ||
        (view.current.field === "size" && view.current.usd === digit)
      );
    }),
  ),
);

export const escapeLeavesField = always(
  now(
    () => view.current.field === "price" || view.current.field === "size",
  ).implies(next(() => !pressed(KEY.escape) || view.current.field === "none")),
);

const formTargets = extract((state) => {
  const form = state.document.querySelector("form.pad");
  if (!form) return [];
  const { innerWidth, innerHeight } = state.window;
  return [
    ...form.querySelectorAll("button:not(:disabled), input:not(:disabled)"),
  ].flatMap((element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (point.x < 0 || point.y < 0) return [];
    if (point.x >= innerWidth || point.y >= innerHeight) return [];
    return [{ fingerprint: getFingerprint(element), point }];
  });
});

export const formClicks = actions(() =>
  formTargets.current.map(({ fingerprint, point }): ActionTemplate => ({
    Click: { fingerprint, point },
  })),
);

const keys = (codes: number[]) =>
  codes.map((code): ActionTemplate => ({ PressKey: { code } }));

export const amountTyping = actions(() => {
  const field = view.current.field;
  if (field !== "price" && field !== "size") return [];
  return weighted([
    [6, { TypeText: { text: { Regexp: "[0-9]{1,6}(\\.[0-9]{1,7})?" } } }],
    [2, { TypeText: { text: { Text: [1, 6] } } }],
    [1, { TypeText: { text: { Regexp: "-?[0-9]*[.,eE+-][0-9]*" } } }],
    [3, keys([KEY.backspace])[0]],
    [1, keys([KEY.escape])[0]],
    [1, keys([KEY.enter])[0]],
    [1, keys([KEY.tab])[0]],
  ]).generate();
});

export const shortcuts = actions(() => {
  if (view.current.field !== "none") return [];
  return keys([
    KEY.m,
    KEY.l,
    KEY.b,
    KEY.s,
    KEY.p,
    KEY.enter,
    KEY.escape,
    ...Array.from({ length: 10 }, (_, digit) => 48 + digit),
  ]);
});
