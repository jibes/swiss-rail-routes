// Android's back button: up one screen, and on the main list the app goes to the background.
import { App } from '@capacitor/app';
import { parentOf } from '../core/parent';
import { isNative } from '../native';
import { closeTopLayer } from '../ui/layers';
import { log } from './log';

export function watchBack() {
  if (!isNative) return () => {};
  const handle = App.addListener('backButton', () => {
    // A sheet, menu or panel open: Back closes it first.
    if (closeTopLayer()) {
      log('back', { did: 'closeLayer' });
      return;
    }
    const up = parentOf(location.hash.slice(1));
    log('back', { did: up === undefined ? 'minimise' : 'up' });
    if (up === undefined) void App.minimizeApp();
    // Replaced, not pushed: the history never grows, so the list stays the bottom.
    else location.replace(`#${up}`);
  });
  return () => void handle.then((h) => h.remove());
}
