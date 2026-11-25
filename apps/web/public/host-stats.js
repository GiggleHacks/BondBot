(function () {
  var style = document.createElement("style");
  style.id = "bb-host-stats-style";
  style.textContent =
    "#bb-host-stats{margin:0 12px 0;padding:0 2px 1px;color:color-mix(in srgb,currentColor 48%,transparent);font:500 9px/1.15 ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}" +
    "#bb-host-stats .row{display:flex;justify-content:space-between;gap:6px}" +
    "#bb-host-stats .track{height:2px;margin:1px 0 4px;border-radius:99px;background:color-mix(in srgb,currentColor 12%,transparent);overflow:hidden}" +
    "#bb-host-stats .fill{height:100%;width:0;border-radius:99px;background:#3dba6a}" +
    "#bb-host-stats .v{color:color-mix(in srgb,currentColor 72%,transparent)}" +
    "#bb-host-stats .ok{color:#2f9e56}#bb-host-stats .fill.ok{background:#3dba6a}" +
    "#bb-host-stats .warn{color:#c48a00}#bb-host-stats .fill.warn{background:#e0a100}" +
    "#bb-host-stats .hot{color:#d64545}#bb-host-stats .fill.hot{background:#e5484d}";
  var el = document.createElement("div");
  el.id = "bb-host-stats";
  el.setAttribute("aria-label", "Server stats");
  el.innerHTML =
    '<div class="row"><span>CPU</span><span class="v" data-k="cpu">\u2014</span></div><div class="track"><div class="fill" data-k="cpu-bar"></div></div><div class="row"><span>RAM</span><span class="v" data-k="ram">\u2014</span></div><div class="track"><div class="fill" data-k="ram-bar"></div></div>';
  function gb(n) {
    return (n / 1073741824).toFixed(1);
  }
  function tone(pct) {
    if (pct >= 85) return "hot";
    if (pct >= 60) return "warn";
    return "ok";
  }
  function paint(node, bar, pct) {
    var level = tone(pct);
    node.classList.remove("ok", "warn", "hot");
    bar.classList.remove("ok", "warn", "hot");
    node.classList.add(level);
    bar.classList.add(level);
    bar.style.width = Math.min(100, pct) + "%";
  }
  function place() {
    var footer = document.querySelector('[data-testid="sidebar-footer"]');
    if (!footer || footer.className.indexOf("flex-col") !== -1) {
      el.remove();
      return;
    }
    if (el.nextElementSibling !== footer) footer.before(el);
  }
  function tick() {
    place();
    if (!el.isConnected) return;
    fetch("/host-stats", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (s) {
        if (!s) return;
        var cpu = el.querySelector('[data-k="cpu"]');
        var cpuBar = el.querySelector('[data-k="cpu-bar"]');
        var ram = el.querySelector('[data-k="ram"]');
        var ramBar = el.querySelector('[data-k="ram-bar"]');
        if (typeof s.cpu === "number") {
          var pct = Math.round(s.cpu * 100);
          cpu.textContent = pct + "%";
          paint(cpu, cpuBar, pct);
        }
        if (s.ramTotal) {
          var used = Math.round((s.ramUsed / s.ramTotal) * 100);
          ram.textContent = gb(s.ramUsed) + " / " + gb(s.ramTotal);
          paint(ram, ramBar, used);
          el.title = "Available " + gb(s.ramAvailable) + " GB";
        }
      })
      .catch(function () {});
  }
  function calmThinking() {
    var buttons = document.querySelectorAll('button[aria-expanded="true"]');
    for (var i = 0; i < buttons.length; i++) {
      var label = buttons[i].textContent || "";
      if (label.indexOf("Thinking") === -1) continue;
      var box = buttons[i].nextElementSibling;
      if (!box || box.tagName !== "DIV") continue;
      box.style.height = "8.5rem";
      box.style.maxHeight = "8.5rem";
      box.style.overflowY = "auto";
      box.style.overflowAnchor = "none";
    }
  }
  function boot() {
    var old = document.getElementById("bb-host-stats-style");
    if (old) old.remove();
    document.head.appendChild(style);
    tick();
    calmThinking();
    setInterval(tick, 3000);
    setInterval(calmThinking, 400);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
