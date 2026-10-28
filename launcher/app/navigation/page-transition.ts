/** Document-entry animations must not run on top of a Router transition. */
export function markClientNavigation() {
  document.documentElement.dataset.launcherClientNavigation = 'true';
}
