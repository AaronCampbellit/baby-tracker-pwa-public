import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type ReactElement,
  type TextareaHTMLAttributes,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckIcon, ChevronDownIcon } from "@radix-ui/react-icons";

export type BabyTheme = "light" | "dark";
export const nativeApp = () =>
  document.documentElement.dataset.runtime === "pwa";
export function applyBabyTheme(theme: BabyTheme) {
  if (!nativeApp()) return;
  const root = document.documentElement;
  root.dataset.babyTheme = theme;
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === "dark" ? "#172334" : "#fffcf7";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#172334" : "#fffcf7");
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute(
      "content",
      theme === "dark" ? "black-translucent" : "default",
    );
  try {
    localStorage.setItem("baby-theme", theme);
  } catch {
    /* The current theme still works without storage. */
  }
}
export function restoreBabyTheme() {
  let theme: BabyTheme = "light";
  try {
    if (localStorage.getItem("baby-theme") === "dark") theme = "dark";
  } catch {
    /* Use the default. */
  }
  applyBabyTheme(theme);
}

export function MobileScroll(p: PropsWithChildren<{ className?: string }>) {
  return <div className={`native-scroll ${p.className ?? ""}`}>{p.children}</div>;
}
export function KeyboardInput(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} />;
}
export function KeyboardTextarea(
  p: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return <textarea {...p} />;
}

// Only take a gesture after its direction is clear. Forms, chart scrubbing and
// scrolling away from the top keep their own gestures.
function useSwipeDismiss(
  node: HTMLElement | null,
  enabled: boolean,
  mode: "sheet" | "notice",
  onDismiss: () => void,
  onBack?: () => void,
) {
  const callbacks = useRef({ onDismiss, onBack });
  callbacks.current = { onDismiss, onBack };
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled || !node) {
      setOffset({ x: 0, y: 0 });
      return;
    }
    let gesture: {
      x: number;
      y: number;
      at: number;
      header: boolean;
      top: boolean;
      axis: "x" | "y" | null;
      dx: number;
      dy: number;
    } | null = null;
    let suppressUntil = 0;
    const start = (
      target: EventTarget | null,
      x: number,
      y: number,
      mouse: boolean,
    ) => {
      if (
        !(target instanceof Element) ||
        target.closest(
          "button,a,input,textarea,select,summary,[role=combobox],[role=option],[data-scroll-drag=ignore],[contenteditable=true]",
        )
      )
        return false;
      if (mode === "sheet" && target.closest(".toast")) return false;
      const header = !!target.closest(
        ".native-sheet-header,.native-sheet-grip,.standby-header",
      );
      if (mouse && mode === "sheet" && !header) return false;
      let top = true;
      for (
        let el: Element | null = target;
        el && node.contains(el);
        el = el.parentElement
      )
        if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight + 1)
          top = false;
      gesture = {
        x,
        y,
        at: performance.now(),
        header,
        top,
        axis: null,
        dx: 0,
        dy: 0,
      };
      return true;
    };
    const move = (x: number, y: number, event: Event) => {
      if (!gesture) return;
      const dx = x - gesture.x,
        dy = y - gesture.y;
      if (!gesture.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (mode === "notice")
          gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        else if (
          dy > 0 &&
          Math.abs(dy) > Math.abs(dx) * 1.2 &&
          (gesture.header || gesture.top)
        )
          gesture.axis = "y";
        else if (
          dx > 0 &&
          Math.abs(dx) > Math.abs(dy) * 1.2 &&
          callbacks.current.onBack
        )
          gesture.axis = "x";
        else {
          gesture = null;
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      gesture.dx = dx;
      gesture.dy = dy;
      setOffset(
        gesture.axis === "x"
          ? { x: mode === "notice" ? dx : Math.max(0, dx), y: 0 }
          : { x: 0, y: mode === "notice" ? dy : Math.max(0, dy) },
      );
    };
    const finish = (cancelled = false) => {
      const g = gesture;
      gesture = null;
      setOffset({ x: 0, y: 0 });
      if (!g?.axis) return;
      suppressUntil = Date.now() + 350;
      const displacement = g.axis === "x" ? g.dx : g.dy;
      const distance =
        mode === "notice" ? Math.abs(displacement) : Math.max(0, displacement);
      const velocity = distance / Math.max(1, performance.now() - g.at);
      if (
        cancelled ||
        (distance < (mode === "notice" ? 50 : 90) &&
          !(distance > 35 && velocity > 0.65))
      )
        return;
      if (mode === "sheet" && g.axis === "x") callbacks.current.onBack?.();
      else callbacks.current.onDismiss();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      suppressUntil = 0;
      if (start(e.target, e.clientX, e.clientY, true))
        node.setPointerCapture(e.pointerId);
    };
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") move(e.clientX, e.clientY, e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      finish();
      if (node.hasPointerCapture(e.pointerId))
        node.releasePointerCapture(e.pointerId);
    };
    const cancel = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === "touch")
        return;
      finish(true);
    };
    const touchStart = (e: TouchEvent) => {
      suppressUntil = 0;
      if (e.touches.length === 1)
        start(e.target, e.touches[0].clientX, e.touches[0].clientY, false);
      else finish(true);
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length === 1)
        move(e.touches[0].clientX, e.touches[0].clientY, e);
      else finish(true);
    };
    const touchEnd = () => finish();
    const click = (e: Event) => {
      if (Date.now() < suppressUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", pointerMove);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("touchstart", touchStart, { passive: true });
    node.addEventListener("touchmove", touchMove, { passive: false });
    node.addEventListener("touchend", touchEnd);
    node.addEventListener("touchcancel", cancel);
    node.addEventListener("click", click, true);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", pointerMove);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("touchstart", touchStart);
      node.removeEventListener("touchmove", touchMove);
      node.removeEventListener("touchend", touchEnd);
      node.removeEventListener("touchcancel", cancel);
      node.removeEventListener("click", click, true);
    };
  }, [node, enabled, mode]);
  return {
    transform: `translate3d(${offset.x}px,${offset.y}px,0)`,
    transition: offset.x || offset.y ? "none" : "transform 180ms ease",
  };
}

type SheetProps = PropsWithChildren<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  theme?: BabyTheme;
  onBack?: () => void;
}>;
export function BottomSheet(p: SheetProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  const close = () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    p.onOpenChange(false);
  };
  const drag = useSwipeDismiss(
    node,
    p.open && nativeApp(),
    "sheet",
    close,
    p.onBack,
  );
  const theme =
    p.theme ??
    (document.documentElement.dataset.babyTheme === "dark" ? "dark" : "light");
  return (
    <Dialog.Root
      open={p.open}
      onOpenChange={(open) => (open ? p.onOpenChange(true) : close())}
    >
      <Dialog.Portal>
        <div className="native-modal">
          <Dialog.Overlay asChild>
            <div className="native-backdrop" />
          </Dialog.Overlay>
          <Dialog.Content
            asChild
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              focusBefore.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              focusBefore.current?.blur();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (focusBefore.current?.isConnected) focusBefore.current.focus();
            }}
          >
            <section
              ref={setNode}
              className={`native-sheet baby-sheet-theme ${theme}`}
              data-baby-theme={theme}
              style={drag}
            >
              <header className="native-sheet-header">
                <div className="native-sheet-grip" aria-hidden="true">
                  <span />
                </div>
                <div className="native-sheet-title-row">
                  <Dialog.Title asChild>
                    <h2>{p.title}</h2>
                  </Dialog.Title>
                  <button
                    type="button"
                    aria-label="Close sheet"
                    onClick={close}
                  >
                    Close
                  </button>
                </div>
                <span className="sr-only">
                  Swipe down to dismiss{p.onBack ? ", or right to go back" : ""}
                  .
                </span>
              </header>
              {p.children}
            </section>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SwipeNotice({
  onDismiss,
  children,
  ...props
}: PropsWithChildren<
  HTMLAttributes<HTMLDivElement> & { onDismiss: () => void }
>) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const drag = useSwipeDismiss(node, true, "notice", onDismiss);
  return (
    <div {...props} ref={setNode} style={drag}>
      <span>{children}</span>
      <button type="button" aria-label="Dismiss message" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((part) =>
      isValidElement<{ children?: ReactNode }>(part)
        ? optionText(part.props.children)
        : String(part),
    )
    .join("");
}
type SelectProps = PropsWithChildren<{
  value: string | number;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}>;
export function Select(p: SelectProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("Choose an option");
  const [theme, setTheme] = useState<BabyTheme>("light");
  const button = useRef<HTMLButtonElement | null>(null);
  const selectedOption = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const options = Children.toArray(p.children)
    .filter((child) => isValidElement(child) && child.type === "option")
    .map((child) => {
      const option = child as ReactElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>;
      return {
        value: String(option.props.value ?? optionText(option.props.children)),
        label: option.props.children,
        disabled: option.props.disabled,
      };
    });
  const selected = options.find((option) => option.value === String(p.value));
  const focusOption =
    selected && !selected.disabled
      ? selected
      : options.find((option) => !option.disabled);
  useEffect(() => {
    const parent = button.current?.closest("label");
    const text = parent
      ? Array.from(parent.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent)
          .join(" ")
          .trim()
      : "";
    if (text) setLabel(text);
  }, []);
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => selectedOption.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);
  const show = () => {
    const parent = button.current?.closest("[data-baby-theme],.baby-app");
    setTheme(
      parent?.getAttribute("data-baby-theme") === "dark" ||
        parent?.classList.contains("dark")
        ? "dark"
        : "light",
    );
    setOpen(true);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        className="baby-select"
        aria-label={p["aria-label"] ?? label}
        aria-haspopup="listbox"
        aria-controls={`${id}-options`}
        aria-expanded={open}
        disabled={p.disabled || !options.length}
        onClick={show}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{selected?.label ?? "Choose an option"}</span>
        <ChevronDownIcon />
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={p["aria-label"] ?? label}
        theme={theme}
      >
        <div className="sheet-body baby-option-body">
          <div
            id={`${id}-options`}
            role="listbox"
            aria-label={p["aria-label"] ?? label}
            onKeyDown={(event) => {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const current = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              let next = current;
              if (event.key === "ArrowDown")
                next = (current + 1) % buttons.length;
              else if (event.key === "ArrowUp")
                next = (current - 1 + buttons.length) % buttons.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = buttons.length - 1;
              else return;
              event.preventDefault();
              buttons[next]?.focus();
            }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                ref={
                  option.value === focusOption?.value
                    ? selectedOption
                    : undefined
                }
                type="button"
                role="option"
                aria-selected={option.value === String(p.value)}
                disabled={option.disabled}
                className="baby-option"
                tabIndex={option.value === focusOption?.value ? 0 : -1}
                onClick={() => {
                  p.onValueChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.value === String(p.value) && <CheckIcon />}
              </button>
            ))}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
