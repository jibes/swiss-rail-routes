// The installed web app asks for a new version itself: a tab left open never navigates.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_EVERY_MS, watchUpdates } from '../src/ui/updateCheck';

afterEach(() => vi.useRealTimers());

describe('watchUpdates', () => {
  it('asks on coming back into view and every hour, and stops when told', () => {
    vi.useFakeTimers();
    const doc = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    doc.visibilityState = 'hidden';
    const update = vi.fn(async () => undefined);
    const stop = watchUpdates(update, doc as never);
    expect(update).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(update).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_EVERY_MS);
    expect(update).toHaveBeenCalledTimes(2);
    // A failed check (offline) is nothing.
    update.mockRejectedValueOnce(new Error('offline'));
    vi.advanceTimersByTime(UPDATE_EVERY_MS);
    expect(update).toHaveBeenCalledTimes(3);
    stop();
    doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(UPDATE_EVERY_MS);
    expect(update).toHaveBeenCalledTimes(3);
  });
});
