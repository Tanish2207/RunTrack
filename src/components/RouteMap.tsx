import { memo, useCallback, useEffect, useMemo, useRef, type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';
import type { RoutePoint } from '../api/types';
import { theme } from '../theme';
import type { RouteMapProps } from './RouteMap.types';

const EMPTY_SEGMENTS: readonly (readonly RoutePoint[])[] = [];
const STREET_ZOOM = 16;
const ROUTE_STROKE_WIDTH = 5;
const DEFAULT_PADDING = {
  top: theme.spacing.xl, right: theme.spacing.xl,
  bottom: theme.spacing.xl, left: theme.spacing.xl,
};

function coordinate(point: RoutePoint): LatLng {
  return { latitude: point.lat, longitude: point.lng };
}

const RouteLine = memo(function RouteLine({ points }: { points: readonly RoutePoint[] }) {
  const coordinates = useMemo(() => points.map(coordinate), [points]);
  if (coordinates.length < 2) return null;
  return <Polyline coordinates={coordinates} strokeColor={theme.colors.accent} strokeWidth={ROUTE_STROKE_WIDTH} geodesic />;
});

const RecordedMarker = memo(function RecordedMarker({ point }: { point: RoutePoint }) {
  const position = useMemo(() => coordinate(point), [point]);
  return <Marker coordinate={position} title="Latest recorded location" pinColor={theme.colors.accent} />;
});

/** Memoized so the 1s HUD ticker never re-renders native map/polyline content. */
export const RouteMap = memo(function RouteMap({
  segments = EMPTY_SEGMENTS,
  currentPoint = null,
  showsUserLocation = false,
  onLocationChange,
  follow = false,
  fitRoute = false,
  interactive = !fitRoute,
  edgePadding = DEFAULT_PADDING,
}: RouteMapProps) {
  const map = useRef<MapView>(null);
  const ready = useRef(false);
  const laidOut = useRef(false);
  const centered = useRef(false);
  const previewCoordinate = useRef<LatLng | null>(null);
  const coordinates = useMemo(
    () => fitRoute ? segments.flatMap((segment) => segment.map(coordinate)) : [],
    [fitRoute, segments],
  );

  const centerOn = useCallback((position: LatLng) => {
    if (!ready.current || !laidOut.current || !map.current) return;
    map.current.setCamera(centered.current ? { center: position } : { center: position, zoom: STREET_ZOOM });
    centered.current = true;
  }, []);

  const updateCamera = useCallback(() => {
    if (!ready.current || !laidOut.current || !map.current) return;
    if (fitRoute && coordinates.length > 0) {
      if (coordinates.length === 1) {
        map.current.setCamera({ center: coordinates[0], zoom: STREET_ZOOM });
      } else {
        map.current.fitToCoordinates(coordinates, { edgePadding, animated: false });
      }
    } else if (follow) {
      const position = currentPoint ? coordinate(currentPoint) : previewCoordinate.current;
      if (position) centerOn(position);
    }
  }, [fitRoute, coordinates, edgePadding, follow, currentPoint, centerOn]);

  useEffect(() => { updateCamera(); }, [updateCamera]);

  const handleLocation: NonNullable<ComponentProps<typeof MapView>['onUserLocationChange']> = useCallback((event) => {
    const position = event.nativeEvent.coordinate;
    if (!showsUserLocation || !position ||
      !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude) ||
      Math.abs(position.latitude) > 90 || Math.abs(position.longitude) > 180) return;

    previewCoordinate.current = { latitude: position.latitude, longitude: position.longitude };
    onLocationChange?.({
      lat: position.latitude, lng: position.longitude,
      accuracy: Number.isFinite(position.accuracy) && position.accuracy >= 0 ? position.accuracy : null,
    });
    // Google Maps does not support the Apple-only followsUserLocation prop.
    if (follow && !currentPoint) centerOn(previewCoordinate.current);
  }, [showsUserLocation, onLocationChange, follow, currentPoint, centerOn]);

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_GOOGLE}
      showsUserLocation={showsUserLocation}
      showsMyLocationButton={false}
      showsCompass={false}
      showsBuildings={false}
      toolbarEnabled={false}
      zoomControlEnabled={false}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      zoomTapEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={false}
      mapPadding={fitRoute ? undefined : edgePadding}
      onUserLocationChange={showsUserLocation ? handleLocation : undefined}
      onMapReady={() => { ready.current = true; updateCamera(); }}
      onLayout={() => { laidOut.current = true; updateCamera(); }}
    >
      {segments.map((segment, index) => <RouteLine key={index} points={segment} />)}
      {!fitRoute && currentPoint ? <RecordedMarker point={currentPoint} /> : null}
      {fitRoute && coordinates.length > 0 ? (
        <Marker coordinate={coordinates[0]} title="Start" pinColor={theme.colors.success} />
      ) : null}
      {fitRoute && coordinates.length > 1 ? (
        <Marker coordinate={coordinates[coordinates.length - 1]} title="Finish" pinColor={theme.colors.accent} />
      ) : null}
    </MapView>
  );
});
