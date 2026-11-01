// Android's back button: up one screen, and on the main list the app goes to the background.
import { App } from '@capacitor/app';
import { parentOf } from '../core/parent';
import { isNative } from '../native';

export function watchBack() {
  if (!isNative) return () => {};
  const handle = App.addListener('backButton', () => {
    const up = parentOf(location.hash.slice(1));
    if (up === undefined) void App.minimizeApp();
    // Replaced, not pushed: the history never grows, so the list stays the bottom.
    else location.replace(`#${up}`);
  });
  return () => void handle.then((h) => h.remove());
}
