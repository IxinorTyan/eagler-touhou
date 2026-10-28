/** Shared optical size and stroke for the masthead's utility controls. */
export function NavigationIcon({name}: {name: 'sun' | 'moon' | 'menu' | 'profile'}) {
  return <svg className="book-navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'sun' && <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></>}
    {name === 'moon' && <path d="M20 14.1A8.3 8.3 0 0 1 9.9 4 8.3 8.3 0 1 0 20 14.1Z"/>}
    {name === 'menu' && <path d="M4 6h16M4 12h16M4 18h16"/>}
    {name === 'profile' && <><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1.5a7 7 0 0 1 14 0V20"/></>}
  </svg>;
}
