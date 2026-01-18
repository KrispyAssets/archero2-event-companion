import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./appShell.css";

const THEME_STORAGE_KEY = "archero2_theme";
const MODE_STORAGE_KEY = "archero2_theme_mode";
const THEME_OPTIONS = [
  { id: "sea-glass", label: "Sea Glass" },
  { id: "guild-ledger", label: "Guild Ledger" },
  { id: "signal-flare", label: "Signal Flare" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const prefersDark = useMemo(
    () => (typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false),
    []
  );
  const [themeId, setThemeId] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) ?? "sea-glass");
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_STORAGE_KEY) ?? (prefersDark ? "dark" : "light"));

  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.mode = mode;
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [themeId, mode]);

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appHeaderInner">
          <Link to="/" className="brand">
            Archero 2 Event Companion
          </Link>

          <div className="headerRight">
            <nav className="nav">
              <Link to="/search" className="navLink">
                Search
              </Link>
              <Link to="/about" className="navLink">
                About
              </Link>
            </nav>
            <div className="themeControls">
              <select value={themeId} onChange={(e) => setThemeId(e.target.value)} aria-label="Theme">
                {THEME_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setMode((prev) => (prev === "light" ? "dark" : "light"))}>
                {mode === "light" ? "Dark" : "Light"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="appMain">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
