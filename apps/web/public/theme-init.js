// Applies the stored theme before first paint (external file because the CSP forbids inline scripts).
(() => {
  const root = document.documentElement;
  try {
    const pref = localStorage.getItem('tresor.theme') || 'system';
    const dark =
      pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  } catch {
    root.dataset.theme = 'dark';
  }
})();
