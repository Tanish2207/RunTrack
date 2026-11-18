import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTrackingStore } from '../../stores/trackingStore';
import { useUiStore } from '../../stores/uiStore';
import { startVoiceDemo, VOICE_DEMO_MESSAGE } from '../voiceDemo';

const speech = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn<() => Promise<void>>() }));
vi.mock('expo-speech', () => speech);
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

let dispose: () => void;
let foreground: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  speech.stop.mockResolvedValue(undefined);
  useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  useSettingsStore.setState({ voiceCoachingEnabled: true });
  useUiStore.setState(useUiStore.getInitialState(), true);
  foreground = true;
  useTrackingStore.getState().start('run');
  dispose = startVoiceDemo(() => foreground);
});

afterEach(() => {
  dispose();
  useTrackingStore.getState().reset();
  vi.useRealTimers();
});

describe('15-second voice demo', () => {
  it('speaks once at 15 seconds without any GPS fixes or fake stats', async () => {
    const segments = useTrackingStore.getState().segments;
    await vi.advanceTimersByTimeAsync(14_999);
    expect(speech.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(speech.stop).toHaveBeenCalledOnce();
    expect(speech.speak).toHaveBeenCalledExactlyOnceWith(VOICE_DEMO_MESSAGE, expect.objectContaining({ language: 'en', rate: 1, pitch: 1 }));
    expect(speech.stop.mock.invocationCallOrder[0]).toBeLessThan(speech.speak.mock.invocationCallOrder[0]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(speech.speak).toHaveBeenCalledOnce();
    expect(useTrackingStore.getState().segments).toBe(segments);
    expect(useTrackingStore.getState().lastAnnouncedKm).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts only active time across pause/resume', async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    useTrackingStore.getState().pause();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(speech.speak).not.toHaveBeenCalled();
    useTrackingStore.getState().resume();
    await vi.advanceTimersByTimeAsync(4999);
    expect(speech.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(speech.speak).toHaveBeenCalledOnce();
    useTrackingStore.getState().pause();
    useTrackingStore.getState().resume();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(speech.speak).toHaveBeenCalledOnce();
  });

  it('skips a muted milestone without replaying it on unmute', async () => {
    useSettingsStore.getState().setVoiceCoachingEnabled(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(useTrackingStore.getState().voiceDemoPlayed).toBe(true);
    useSettingsStore.getState().setVoiceCoachingEnabled(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('allows unmuting before the milestone', async () => {
    useSettingsStore.getState().setVoiceCoachingEnabled(false);
    await vi.advanceTimersByTimeAsync(10_000);
    useSettingsStore.getState().setVoiceCoachingEnabled(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(speech.speak).toHaveBeenCalledOnce();
  });

  it.each(['pause', 'mute', 'stop', 'dispose'] as const)('interrupts speech immediately on %s', async (action) => {
    await vi.advanceTimersByTimeAsync(15_000);
    expect(speech.stop).toHaveBeenCalledOnce();
    if (action === 'pause') useTrackingStore.getState().pause();
    if (action === 'mute') useSettingsStore.getState().setVoiceCoachingEnabled(false);
    if (action === 'stop') useTrackingStore.getState().stop(70);
    if (action === 'dispose') dispose();
    expect(speech.stop).toHaveBeenCalledTimes(2);
  });

  it.each(['stop', 'reset', 'dispose'] as const)('cancels a pending announcement on %s', async (action) => {
    await vi.advanceTimersByTimeAsync(5000);
    if (action === 'stop') useTrackingStore.getState().stop(70);
    if (action === 'reset') useTrackingStore.getState().reset();
    if (action === 'dispose') dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('does not speak in the background', async () => {
    foreground = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('does not replay after engine reattachment, but does play for a new session', async () => {
    await vi.advanceTimersByTimeAsync(15_000);
    dispose();
    dispose = startVoiceDemo(() => foreground);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(speech.speak).toHaveBeenCalledOnce();
    useTrackingStore.getState().stop(70);
    useTrackingStore.getState().reset();
    useTrackingStore.getState().start('walk');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(speech.speak).toHaveBeenCalledTimes(2);
  });

  it('cannot speak after mute arrives while native stop is pending', async () => {
    let finishStop!: () => void;
    speech.stop.mockImplementationOnce(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    await vi.advanceTimersByTimeAsync(15_000);
    useSettingsStore.getState().setVoiceCoachingEnabled(false);
    finishStop();
    await Promise.resolve();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('reports speech failure without stopping the recording', async () => {
    speech.stop.mockRejectedValueOnce(new Error('TTS unavailable'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useTrackingStore.getState().status).toBe('recording');
    expect(useUiStore.getState().toast).toMatchObject({ type: 'error', message: expect.stringContaining('Voice demo') });
    expect(speech.speak).not.toHaveBeenCalled();
  });
});
