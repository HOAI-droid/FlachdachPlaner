export { EPS } from "./eps";
export type { Polygon, Ring, Vec2 } from "./types";
export {
  orientation, pointInPolygon, pointInRing, polygonArea, polygonCentroid,
  ringArea, ringCentroid, signedArea, withOrientation, type PointLocation,
} from "./polygon";
export {
  closestPointOnSegment, cross, dist, distPointSegment, projectOnSegment,
  segmentIntersection, type SegmentIntersection,
} from "./segment";
export {
  CLIPPER_SCALE, difference, intersection, offset, union,
  type OffsetJoin, type OffsetOptions,
} from "./clipper";
