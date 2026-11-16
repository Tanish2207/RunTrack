import { describe, expect, it } from 'vitest';

import { formatDate, formatDistance, formatDuration, formatPace, paceToSpeech } from '../format';

describe('formatDistance', () => {
  it('formats to 2 decimals with a km unit', () => {
    expect(formatDistance(5.024)).toBe('5.02 km');
    expect(formatDistance(0)).toBe('0.00 km');
  });
});

describe('formatDuration', () => {
  it('formats h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05'); // ticket value
    expect(formatDuration(0)).toBe('0:00:00'); // ticket value
    expect(formatDuration(125)).toBe('0:02:05');
  });
});

describe('formatPace', () => {
  it('formats mm:ss /km', () => {
    expect(formatPace(342)).toBe('5:42 /km'); // ticket value (342 s = 5 min 42 s)
  });

  it('renders an em dash for unknown/negative pace', () => {
    expect(formatPace(0)).toBe('—'); // ticket value
    expect(formatPace(-1)).toBe('—');
  });
});

describe('paceToSpeech', () => {
  it('spells out minutes and seconds', () => {
    expect(paceToSpeech(342)).toBe('5 minutes 42 seconds per kilometer'); // ticket value
    expect(paceToSpeech(61)).toBe('1 minute 1 second per kilometer'); // ticket value
  });

  it('singularizes exactly one unit; walker hour-pace reads naturally', () => {
    expect(paceToSpeech(60)).toBe('1 minute per kilometer'); // ticket value
    expect(paceToSpeech(45)).toBe('45 seconds per kilometer'); // minutes-only 0
    expect(paceToSpeech(870)).toBe('14 minutes 30 seconds per kilometer'); // walker pace (ticket note)
  });

  it('falls back for unknown or absurd pace', () => {
    expect(paceToSpeech(0)).toBe('your current pace'); // ticket value
    expect(paceToSpeech(-5)).toBe('your current pace');
    expect(paceToSpeech(7200)).toBe('your current pace'); // > 1 h/km clamp (ticket note)
  });
});

describe('formatDate', () => {
  it('renders a human date containing a month name (loose assert)', () => {
    // 2026-11-15 ~noon UTC — mid-month, so every UTC offset still lands in November.
    const ts = Date.UTC(2026, 10, 15, 12, 0, 0);
    const out = formatDate(ts);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    expect(months.some((m) => out.includes(m))).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE])(
    'does not crash a stored-activity row for an invalid date (%s)', (epochMs) => {
      expect(formatDate(epochMs)).toBe('Date unavailable');
    },
  );
});
