import { useState } from "react";
import { exportSaveCode, importSaveCode } from "../state/userStateStore";
import AppShell from "../ui/AppShell";

export default function AboutPage() {
  const [exportCode, setExportCode] = useState("");
  const [importCode, setImportCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(
    () => import.meta.env.DEV && localStorage.getItem("dev_mode") === "1"
  );

  function handleExport() {
    const code = exportSaveCode();
    setExportCode(code);
    setStatus("Export code generated.");
  }

  async function handleCopy() {
    if (!exportCode) {
      setStatus("Generate an export code first.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportCode);
      } else {
        const el = document.createElement("textarea");
        el.value = exportCode;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        el.remove();
      }
      setStatus("Export code copied to clipboard.");
    } catch {
      setStatus("Copy failed. Select the code manually.");
    }
  }

  function handleImport() {
    const trimmed = importCode.trim();
    if (!trimmed) {
      setStatus("Paste a code to import.");
      return;
    }
    const result = importSaveCode(trimmed);
    if (result.ok) {
      setStatus("Import successful. Your progress has been replaced.");
    } else {
      setStatus(result.error);
    }
  }

  return (
    <AppShell>
      <h1>About</h1>
      <p>Archero 2 Companion — Not affiliated with Habby.</p>
      <p style={{ color: "var(--text-subtle)" }}>
        Inspired by the Archero 2 Discord community, this project brings community research together to help new and veteran players with guides,
        tools, FAQ, and more across every aspect of the game.
      </p>
      <p style={{ color: "var(--text-subtle)" }}>All guides and data come from resources gathered by the Archero 2 Discord community.</p>
      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <p style={{ color: "var(--text-subtle)", margin: 0 }}>Created by Zerkzis.</p>
          {import.meta.env.DEV ? (
            <button
              type="button"
              onClick={() => {
                const next = !devMode;
                setDevMode(next);
                if (next) {
                  localStorage.setItem("dev_mode", "1");
                } else {
                  localStorage.removeItem("dev_mode");
                }
                window.location.reload();
              }}
              style={{
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                padding: "2px 6px",
                fontSize: 10,
                lineHeight: 1,
                height: 20,
              }}
            >
              Dev Mode: {devMode ? "On" : "Off"}
            </button>
          ) : null}
        </div>
        <p style={{ color: "var(--text-subtle)", margin: 0 }}>GitHub: KrispyAssets</p>
        <p style={{ color: "var(--text-subtle)", margin: 0 }}>In-game: KrisFromBali (User ID 115838558).</p>
      </div>

      <section style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2>Export / Import Save Code</h2>
        <p style={{ maxWidth: 720 }}>
          Export creates a portable code for your task progress. Import replaces your current progress with the pasted code.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={handleExport}>
            Generate Export Code
          </button>
          <button type="button" onClick={handleCopy}>
            Copy to Clipboard
          </button>
        </div>

        <textarea value={exportCode} readOnly rows={4} placeholder="Your export code will appear here." style={{ width: "100%", maxWidth: 840 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
            rows={4}
            placeholder="Paste an export code to import."
            style={{ width: "100%", maxWidth: 840 }}
          />
          <button type="button" onClick={handleImport} style={{ alignSelf: "flex-start" }}>
            Import Code
          </button>
        </div>

        {status ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{status}</div> : null}
      </section>
    </AppShell>
  );
}
