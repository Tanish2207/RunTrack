import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoutePoint } from '../../api/types';
import type { MapEdgePadding, PreviewLocation, RouteMapProps } from '../RouteMap.types';
import { RouteMap } from '../RouteMap';

type InspectedElement = ReactElement<Record<string, unknown>>;
type Effect = () => void | (() => void);

/** JSX/imperative orchestration only; this does not render a native map. */
const hooks = vi.hoisted(() => {
  const refs: { current: unknown }[] = [];
  const memos: { value: unknown; deps: readonly unknown[] }[] = [];
  const effects: { run: Effect; deps?: readonly unknown[]; pending: boolean }[] = [];
  let refIndex = 0;
  let memoIndex = 0;
  let effectIndex = 0;

  function changed(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) {
    return !previous || !next || previous.length !== next.length ||
      next.some((value, index) => !Object.is(value, previous[index]));
  }

  function memoized<T>(factory: () => T, deps: readonly unknown[]): T {
    const index = memoIndex++;
    if (!memos[index] || changed(memos[index].deps, deps)) {
      memos[index] = { value: factory(), deps };
    }
    return memos[index].value as T;
  }

  return {
    useMemo: memoized,
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => memoized(() => callback, deps),
    useRef: <T,>(initial: T): { current: T } => {
      const index = refIndex++;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index] as { current: T };
    },
    useEffect: (run: Effect, deps?: readonly unknown[]) => {
      const index = effectIndex++;
      if (!effects[index] || changed(effects[index].deps, deps)) {
        effects[index] = { run, deps, pending: true };
      }
    },
    beginRender: () => { refIndex = 0; memoIndex = 0; effectIndex = 0; },
    commit: () => {
      for (const effect of effects) {
        if (effect.pending) { effect.run(); effect.pending = false; }
      }
    },
    reset: () => { refs.length = 0; memos.length = 0; effects.length = 0; },
  };
});

const native = vi.hoisted(() => ({
  setCamera: vi.fn(),
  fitToCoordinates: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  memo: <T,>(component: T) => component,
  useMemo: hooks.useMemo,
  useCallback: hooks.useCallback,
  useRef: hooks.useRef,
  useEffect: hooks.useEffect,
}));
vi.mock('react-native', () => ({ StyleSheet: { absoluteFill: 'absoluteFill' } }));
vi.mock('react-native-maps', () => ({
  default: 'MapView', Marker: 'Marker', Polyline: 'Polyline', PROVIDER_GOOGLE: 'google',
}));
vi.mock('../../theme', () => ({
  theme: {
    spacing: { xl: 24 },
    colors: { accent: 'accent', success: 'success' },
  },
}));

const first: RoutePoint = { lat: 10, lng: 20, timestamp: 1000 };
const last: RoutePoint = { lat: 10.02, lng: 20.03, timestamp: 5000, speed: 3 };
const segments: RoutePoint[][] = [[first], [last]];
const coordinates = [
  { latitude: first.lat, longitude: first.lng },
  { latitude: last.lat, longitude: last.lng },
];
const padding: MapEdgePadding = { top: 12, right: 16, bottom: 24, left: 32 };

function render(props: RouteMapProps = {}, attach = true): InspectedElement {
  hooks.beginRender();
  const tree = RouteMap(props);
  if (!isValidElement<Record<string, unknown>>(tree)) throw new Error('Expected map JSX.');
  expect(tree.type).toBe('MapView');
  const ref = tree.props.ref as { current: typeof native | null };
  ref.current = attach ? native : null;
  hooks.commit();
  return tree;
}

function invoke(tree: InspectedElement, name: 'onMapReady' | 'onLayout'): void {
  const handler = tree.props[name];
  if (typeof handler !== 'function') throw new Error(`Expected ${name}.`);
  (handler as () => void)();
}

function locate(tree: InspectedElement, coordinate: unknown): void {
  const handler = tree.props.onUserLocationChange;
  if (typeof handler !== 'function') throw new Error('Expected live preview handler.');
  (handler as (event: unknown) => void)({ nativeEvent: { coordinate } });
}

function children(tree: InspectedElement): InspectedElement[] {
  const list = (Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children]).flat();
  return list.filter(isValidElement<Record<string, unknown>>);
}

function markers(tree: InspectedElement): InspectedElement[] {
  return children(tree).filter((element) => element.type === 'Marker');
}

function expectGestures(tree: InspectedElement, enabled: boolean): void {
  expect(tree.props).toMatchObject({
    scrollEnabled: enabled, zoomEnabled: enabled,
    zoomTapEnabled: enabled, rotateEnabled: enabled,
    pitchEnabled: false,
  });
}

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
});

describe('RouteMap gestures and location ownership', () => {
  it('keeps live-map gestures enabled without requesting location by default', () => {
    const tree = render();
    expectGestures(tree, true);
    expect(tree.props).toMatchObject({
      provider: 'google', showsUserLocation: false, showsMyLocationButton: false,
      toolbarEnabled: false, zoomControlEnabled: false,
    });
    expect(tree.props.onUserLocationChange).toBeUndefined();
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    expect(native.setCamera).not.toHaveBeenCalled();
    expect(native.fitToCoordinates).not.toHaveBeenCalled();
  });

  it('preserves the static fitted Summary default', () => {
    const tree = render({ segments, fitRoute: true });
    expectGestures(tree, false);
    expect(tree.props.showsUserLocation).toBe(false);
    expect(tree.props.onUserLocationChange).toBeUndefined();
    expect(tree.props.mapPadding).toBeUndefined();
  });

  it('allows fitted Detail pan/zoom without enabling live location or camera following', () => {
    const tree = render({ segments, fitRoute: true, interactive: true });
    expectGestures(tree, true);
    expect(tree.props.showsUserLocation).toBe(false);
    expect(tree.props.onUserLocationChange).toBeUndefined();
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    expect(native.fitToCoordinates).toHaveBeenCalledOnce();
    expect(native.setCamera).not.toHaveBeenCalled();
  });

  it('can disable gestures independently of live following', () => {
    const tree = render({ currentPoint: first, follow: true, interactive: false });
    expectGestures(tree, false);
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    expect(native.setCamera).toHaveBeenCalledWith({ center: coordinates[0], zoom: 16 });
  });
});

describe('RouteMap fitted-route orchestration', () => {
  it.each(['ready first', 'layout first'])('waits for readiness and layout, %s', (order) => {
    const tree = render({ segments, fitRoute: true, interactive: true, edgePadding: padding });
    const firstEvent = order === 'ready first' ? 'onMapReady' : 'onLayout';
    const lastEvent = order === 'ready first' ? 'onLayout' : 'onMapReady';
    expect(native.fitToCoordinates).not.toHaveBeenCalled();
    invoke(tree, firstEvent);
    expect(native.fitToCoordinates).not.toHaveBeenCalled();
    invoke(tree, lastEvent);
    expect(native.fitToCoordinates).toHaveBeenCalledExactlyOnceWith(coordinates, {
      edgePadding: padding, animated: false,
    });
    expect(native.setCamera).not.toHaveBeenCalled();
    expect(children(tree).filter(({ props }) => 'points' in props).map(({ props }) => props.points)).toEqual(segments);
    expect(markers(tree).map(({ props }) => [props.title, props.coordinate])).toEqual([
      ['Start', coordinates[0]], ['Finish', coordinates[1]],
    ]);
  });

  it('centers a one-point activity without calling fitToCoordinates with a degenerate route', () => {
    const tree = render({ segments: [[first]], fitRoute: true, interactive: true });
    invoke(tree, 'onLayout');
    invoke(tree, 'onMapReady');
    expect(native.setCamera).toHaveBeenCalledExactlyOnceWith({ center: coordinates[0], zoom: 16 });
    expect(native.fitToCoordinates).not.toHaveBeenCalled();
    expect(markers(tree).map(({ props }) => props.title)).toEqual(['Start']);
  });

  it('does not fit or invent markers for an empty route', () => {
    const tree = render({ segments: [], fitRoute: true, interactive: true });
    invoke(tree, 'onLayout');
    invoke(tree, 'onMapReady');
    expect(native.setCamera).not.toHaveBeenCalled();
    expect(native.fitToCoordinates).not.toHaveBeenCalled();
    expect(markers(tree)).toEqual([]);
  });

  it('safely ignores readiness/layout when the native ref is unavailable', () => {
    const tree = render({ segments, fitRoute: true }, false);
    expect(() => { invoke(tree, 'onMapReady'); invoke(tree, 'onLayout'); }).not.toThrow();
    expect(native.fitToCoordinates).not.toHaveBeenCalled();
  });

  it('does not snap an interactive camera back just because gesture props change or the parent rerenders', () => {
    const tree = render({ segments, fitRoute: true, interactive: true });
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    render({ segments, fitRoute: true, interactive: true });
    render({ segments, fitRoute: true, interactive: false });
    expect(native.fitToCoordinates).toHaveBeenCalledOnce();
  });

  it('fits newly loaded stored coordinates without modifying their order or source points', () => {
    const original = structuredClone(segments);
    const tree = render({ segments, fitRoute: true, interactive: true });
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    const extended = [...segments, [{ lat: 11, lng: 22, timestamp: 7000 }]];
    render({ segments: extended, fitRoute: true, interactive: true });
    expect(native.fitToCoordinates).toHaveBeenLastCalledWith([
      ...coordinates, { latitude: 11, longitude: 22 },
    ], expect.objectContaining({ animated: false }));
    expect(segments).toEqual(original);
  });
});

describe('RouteMap live-preview regression coverage', () => {
  it('keeps the last pre-readiness preview and follows it only after map layout', () => {
    const onLocationChange = vi.fn<(location: PreviewLocation) => void>();
    const tree = render({ showsUserLocation: true, follow: true, onLocationChange });
    locate(tree, { latitude: 12, longitude: 23, accuracy: 8 });
    expect(onLocationChange).toHaveBeenCalledExactlyOnceWith({ lat: 12, lng: 23, accuracy: 8 });
    expect(native.setCamera).not.toHaveBeenCalled();
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    expect(native.setCamera).toHaveBeenCalledExactlyOnceWith({ center: { latitude: 12, longitude: 23 }, zoom: 16 });
    locate(tree, { latitude: 13, longitude: 24, accuracy: null });
    expect(native.setCamera).toHaveBeenLastCalledWith({ center: { latitude: 13, longitude: 24 } });
    expect(onLocationChange).toHaveBeenLastCalledWith({ lat: 13, lng: 24, accuracy: null });
  });

  it('uses recorded points rather than preview callbacks when following an active session', () => {
    const onLocationChange = vi.fn<(location: PreviewLocation) => void>();
    const tree = render({ segments, currentPoint: first, showsUserLocation: true, follow: true, onLocationChange });
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    expect(native.setCamera).toHaveBeenCalledExactlyOnceWith({ center: coordinates[0], zoom: 16 });
    locate(tree, { latitude: 12, longitude: 23, accuracy: 8 });
    expect(native.setCamera).toHaveBeenCalledOnce();
    expect(onLocationChange).toHaveBeenCalledOnce();
    render({ segments, currentPoint: last, showsUserLocation: true, follow: true, onLocationChange });
    expect(native.setCamera).toHaveBeenLastCalledWith({ center: coordinates[1] });
    expect(native.fitToCoordinates).not.toHaveBeenCalled();
  });

  it.each([
    undefined, null,
    { latitude: Number.NaN, longitude: 20 },
    { latitude: 10, longitude: Number.POSITIVE_INFINITY },
    { latitude: 91, longitude: 20 },
    { latitude: 10, longitude: -181 },
  ])('ignores an invalid preview coordinate (%j)', (coordinate) => {
    const onLocationChange = vi.fn<(location: PreviewLocation) => void>();
    const tree = render({ showsUserLocation: true, follow: true, onLocationChange });
    invoke(tree, 'onMapReady');
    invoke(tree, 'onLayout');
    locate(tree, coordinate);
    expect(onLocationChange).not.toHaveBeenCalled();
    expect(native.setCamera).not.toHaveBeenCalled();
  });

  it('removes the preview handler when live location is disabled', () => {
    render({ showsUserLocation: true, follow: true });
    const tree = render({ showsUserLocation: false, follow: false });
    expect(tree.props.onUserLocationChange).toBeUndefined();
  });
});
