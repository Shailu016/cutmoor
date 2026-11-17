import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { boxBetween, dragBox, MIN_BOX, toPicturePoint, type Box, type Handle, type Ratio } from "../lib/crop";

interface Picture {
  width: number;
  height: number;
}

interface BaseProps {
  /** The picture to show (a small preview is fine). */
  src: string;
  /** The real size of the picture. Boxes are in these pixels, whatever size the preview is. */
  picture: Picture;
  alt: string;
  disabled?: boolean;
}

interface CropProps extends BaseProps {
  mode: "crop";
  box: Box;
  ratio: Ratio;
  circle?: boolean;
  onBoxChange: (box: Box) => void;
}

interface DrawProps extends BaseProps {
  mode: "draw";
  boxes: Box[];
  onBoxesChange: (boxes: Box[]) => void;
}

const percent = (value: number, total: number) => `${(value / total) * 100}%`;

/**
 * A picture with boxes on it that the visitor drags: one box with four corner handles for cropping, or any number of
 * boxes drawn with the pointer for hiding parts of a picture. It works with a mouse, a finger, or a pen, and the boxes
 * are kept in the picture's real pixels.
 */
export function PictureStage(props: CropProps | DrawProps) {
  const { src, picture, alt, disabled = false } = props;
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle | "draw"; start: Box; origin: { x: number; y: number } } | null>(null);

  const point = (event: ReactPointerEvent) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toPicturePoint(event.clientX, event.clientY, rect, picture);
  };

  const begin = (event: ReactPointerEvent, handle: Handle | "draw", start: Box) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    stage.current?.setPointerCapture(event.pointerId);
    drag.current = { handle, start, origin: point(event) };
  };

  const move = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active) return;
    const now = point(event);
    if (props.mode === "crop" && active.handle !== "draw") {
      props.onBoxChange(dragBox(active.start, active.handle, now.x - active.origin.x, now.y - active.origin.y, props.ratio, picture.width, picture.height));
    } else if (props.mode === "draw" && active.handle === "draw") {
      const next = boxBetween(active.origin, now);
      const rest = props.boxes.slice(0, -1);
      props.onBoxesChange([...rest, next]);
    }
  };

  const end = (event: ReactPointerEvent) => {
    const active = drag.current;
    drag.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
    // A click with no drag leaves a speck, not a region: drop boxes too small to mean anything.
    if (props.mode === "draw" && active?.handle === "draw") {
      const last = props.boxes[props.boxes.length - 1];
      const minimum = Math.max(6, Math.min(picture.width, picture.height) * 0.01);
      if (last && (last.w < minimum || last.h < minimum)) props.onBoxesChange(props.boxes.slice(0, -1));
    }
  };

  const startDraw = (event: ReactPointerEvent) => {
    if (props.mode !== "draw" || disabled) return;
    const origin = point(event);
    props.onBoxesChange([...props.boxes, { x: origin.x, y: origin.y, w: 0, h: 0 }]);
    begin(event, "draw", { x: origin.x, y: origin.y, w: 0, h: 0 });
  };

  return (
    <div
      ref={stage}
      className="stage"
      style={{ aspectRatio: `${picture.width} / ${picture.height}`, cursor: props.mode === "draw" && !disabled ? "crosshair" : "default" }}
      onPointerDown={props.mode === "draw" ? startDraw : undefined}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <img src={src} alt={alt} draggable={false} />
      {props.mode === "crop" && (
        <div
          className={props.circle ? "stage-box is-circle" : "stage-box"}
          style={{ left: percent(props.box.x, picture.width), top: percent(props.box.y, picture.height), width: percent(props.box.w, picture.width), height: percent(props.box.h, picture.height) }}
          onPointerDown={(event) => begin(event, "move", props.box)}
          role="group"
          aria-label="Crop area. Drag to move it, or drag a corner to resize."
        >
          {(["nw", "ne", "sw", "se"] as const).map((handle) => (
            <span key={handle} className="stage-handle" data-pos={handle} onPointerDown={(event) => begin(event, handle, props.box)} />
          ))}
        </div>
      )}
      {props.mode === "draw" &&
        props.boxes.map((box, index) => (
          <div
            key={index}
            className={index === props.boxes.length - 1 ? "stage-region is-active" : "stage-region"}
            style={{ left: percent(box.x, picture.width), top: percent(box.y, picture.height), width: percent(box.w, picture.width), height: percent(box.h, picture.height) }}
            aria-hidden="true"
          />
        ))}
    </div>
  );
}

export { MIN_BOX };
