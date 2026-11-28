// Runs before first paint, as a file because the app's CSP blocks inline scripts.
(() => {
  const key = "rakazo.uiAppearance";
  let preference = "system";
  try {
    const stored = localStorage.getItem(key);
    if (["system", "light", "dark", "dark-blue", "dark-purple"].includes(stored))
      preference = stored;
  } catch {}
  const systemLight =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  const theme =
    preference === "system"
      ? systemLight
        ? "light"
        : "dark"
      : preference === "light"
        ? "light"
        : "dark";
  const palette = { "dark-blue": "blue", "dark-purple": "purple" }[preference];
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (palette) root.dataset.palette = palette;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  const tinted = { blue: "#0b1220", purple: "#16141c" }[palette];
  const plain = theme === "light" ? "#ffffff" : "#0a0a0a";
  if (meta) meta.setAttribute("content", tinted || plain);
  // Optional chat colours and terminal font, chosen in Settings on this device.
  try {
    if (localStorage.getItem("bondbot.chatColors") === "on") root.dataset.chatColors = "on";
    if (localStorage.getItem("bondbot.terminalFont") === "on") root.dataset.terminalFont = "on";
  } catch {}
  // macOS draws regular text at 420 (see --font-weight-normal); iPads report a Mac platform too.
  const nav = typeof navigator === "object" ? navigator : undefined;
  if (nav && /^Mac/.test(nav.platform || "") && !(nav.maxTouchPoints > 1)) {
    document.documentElement.dataset.os = "mac";
  }
})();
