import { useState } from "react";
import { exportSaveCode, importSaveCode } from "../state/userStateStore";
import AppShell from "../ui/AppShell";

export default function AboutPage() {
  const [exportCode, setExportCode] = useState("");
  const [importCode, setImportCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);

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
      <p>Archero 2 Event Companion</p>

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

        <textarea
          value={exportCode}
          readOnly
          rows={4}
          placeholder="Your export code will appear here."
          style={{ width: "100%", maxWidth: 840 }}
        />

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
