import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import { joinClassNames } from "../classNames";
import { PopoverSurface } from "../popover/PopoverPrimitives";

export type SelectMenuOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type SelectMenuProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "onChange" | "value"
> & {
  value: string;
  options: SelectMenuOption[];
  onValueChange: (value: string) => void;
  placeholder?: ReactNode;
  rootClassName?: string;
  popoverClassName?: string;
  optionClassName?: string;
  popoverAlign?: "start" | "end";
  popoverPlacement?: "bottom" | "top";
  showChevron?: boolean;
};

function nextEnabledIndex(
  options: SelectMenuOption[],
  startIndex: number,
  direction: 1 | -1,
) {
  if (options.length === 0) {
    return -1;
  }

  let index = startIndex;
  for (let checked = 0; checked < options.length; checked += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index]?.disabled) {
      return index;
    }
  }
  return -1;
}

function firstEnabledIndex(options: SelectMenuOption[]) {
  return options.findIndex((option) => !option.disabled);
}

function lastEnabledIndex(options: SelectMenuOption[]) {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) {
      return index;
    }
  }
  return -1;
}

export function SelectMenu({
  value,
  options,
  onValueChange,
  placeholder,
  rootClassName,
  popoverClassName,
  optionClassName,
  popoverAlign = "start",
  popoverPlacement = "bottom",
  showChevron = true,
  className,
  disabled,
  id,
  onKeyDown,
  onClick,
  ...buttonProps
}: SelectMenuProps) {
  const generatedId = useId();
  const buttonId = id ?? `${generatedId}-trigger`;
  const listboxId = `${generatedId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : firstEnabledIndex(options),
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const selectedLabel = selectedOption?.label ?? placeholder ?? value;

  const close = useCallback(() => setOpen(false), []);

  const openMenu = useCallback(() => {
    if (disabled) {
      return;
    }
    const nextIndex =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : firstEnabledIndex(options);
    setActiveIndex(nextIndex);
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const selectIndex = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) {
        return;
      }
      onValueChange(option.value);
      close();
    },
    [close, onValueChange, options],
  );

  useEffect(() => {
    if (disabled) {
      close();
    }
  }, [close, disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      close();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [close, open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (disabled) {
      return;
    }

    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        nextEnabledIndex(options, current >= 0 ? current : -1, 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        nextEnabledIndex(
          options,
          current >= 0 ? current : options.length,
          -1,
        ),
      );
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex(options));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(lastEnabledIndex(options));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectIndex(activeIndex);
    }
  };

  return (
    <div
      className={joinClassNames("ds-select", open && "is-open", rootClassName)}
      ref={rootRef}
    >
      <button
        {...buttonProps}
        id={buttonId}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        className={joinClassNames("ds-select-trigger", className)}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || disabled) {
            return;
          }
          setOpen((current) => {
            if (current) {
              return false;
            }
            const nextIndex =
              selectedIndex >= 0 && !options[selectedIndex]?.disabled
                ? selectedIndex
                : firstEnabledIndex(options);
            setActiveIndex(nextIndex);
            return true;
          });
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="ds-select-trigger-label">{selectedLabel}</span>
        {showChevron ? (
          <span className="ds-select-trigger-chevron" aria-hidden>
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        ) : null}
      </button>
      {open && (
        <PopoverSurface
          id={listboxId}
          className={joinClassNames("ds-select-popover", popoverClassName)}
          role="listbox"
          aria-labelledby={buttonId}
          data-align={popoverAlign}
          data-placement={popoverPlacement}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                id={`${listboxId}-option-${index}`}
                key={`${option.value}-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                className={joinClassNames(
                  "ds-popover-item ds-select-option",
                  selected && "is-selected",
                  active && "is-active",
                  optionClassName,
                )}
                onMouseEnter={() => {
                  if (!option.disabled) {
                    setActiveIndex(index);
                  }
                }}
                onClick={() => selectIndex(index)}
              >
                <span className="ds-select-option-label">{option.label}</span>
                <span className="ds-select-option-check" aria-hidden>
                  <Check size={13} strokeWidth={2} />
                </span>
              </button>
            );
          })}
        </PopoverSurface>
      )}
    </div>
  );
}
