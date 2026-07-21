import {
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
} from "react";

type ActivePress = {
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
};

const MAX_MOVEMENT_PX = 10;

export function useLongPress<T extends HTMLElement>(
  onLongPress: (() => void) | undefined,
  delay: number,
) {
  const activePress = useRef<ActivePress | undefined>(undefined);
  const [isHolding, setIsHolding] = useState(false);

  useEffect(() => () => clearTimeout(activePress.current?.timer), []);

  const cancelPress = () => {
    const press = activePress.current;
    if (!press) return;

    clearTimeout(press.timer);
    activePress.current = undefined;
    setIsHolding(false);
  };

  const onPointerDown: PointerEventHandler<T> = (event) => {
    if (!onLongPress || !event.isPrimary || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("[data-long-press-ignore]")) {
      return;
    }

    cancelPress();

    const timer = setTimeout(() => {
      if (activePress.current?.timer !== timer) return;
      activePress.current = undefined;
      setIsHolding(false);
      onLongPress();
    }, delay);

    activePress.current = {
      x: event.clientX,
      y: event.clientY,
      timer,
    };
    setIsHolding(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove: PointerEventHandler<T> = (event) => {
    const press = activePress.current;
    if (!press) return;

    const x = event.clientX - press.x;
    const y = event.clientY - press.y;
    if (x * x + y * y > MAX_MOVEMENT_PX * MAX_MOVEMENT_PX) cancelPress();
  };

  const onContextMenu: MouseEventHandler<T> = (event) => {
    if (activePress.current) event.preventDefault();
  };

  return {
    isHolding,
    longPressProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      onLostPointerCapture: cancelPress,
      onContextMenu,
    },
  };
}
