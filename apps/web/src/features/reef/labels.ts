import { Vector3, type Camera } from "three";

/** World-space anchors published by 3D components, read by the DOM label layer. */
export const anchors = new Map<string, { pos: Vector3; visible: boolean }>();

export function setAnchor(id: string, pos: Vector3, visible: boolean) {
  const a = anchors.get(id);
  if (a) {
    a.pos.copy(pos);
    a.visible = visible;
  } else anchors.set(id, { pos: pos.clone(), visible });
}

/** The live R3F camera and canvas size, for projecting anchors. */
export const bridge: { camera: Camera | null; width: number; height: number } = { camera: null, width: 1, height: 1 };
