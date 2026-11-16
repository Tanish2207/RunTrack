import type { RoutePoint } from '../api/types';

export interface MapEdgePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A map's location event is a preview, never an input to the tracking store. */
export interface PreviewLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export interface RouteMapProps {
  segments?: readonly (readonly RoutePoint[])[];
  currentPoint?: RoutePoint | null;
  showsUserLocation?: boolean;
  onLocationChange?: (location: PreviewLocation) => void;
  follow?: boolean;
  /** Fit the saved route independently of gesture support. */
  fitRoute?: boolean;
  /** Defaults to false for fitted review maps, true for live maps. */
  interactive?: boolean;
  edgePadding?: MapEdgePadding;
}
