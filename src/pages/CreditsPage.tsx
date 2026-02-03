import AppShell from "../ui/AppShell";

export default function CreditsPage() {
  return (
    <AppShell>
      <h1>Credits</h1>
      <p>Thank you to the community members who inspired and informed this project.</p>

      <section style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <div style={{ fontWeight: 800 }}>Kai&apos;thulhu</div>
          <p style={{ marginTop: 6, color: "var(--text-muted)" }}>Fishing companion tool and original fishing guide.</p>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Show contributions</summary>
            <div
              style={{
                display: "grid",
                gap: 8,
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Fishing Companion App</div>
                <a
                  className="linkButton"
                  href="https://ksun4176.github.io/archero2-fish-companion/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View tool
                </a>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Original Fishing Guide</div>
                <a
                  className="linkButton"
                  href="https://discord.com/channels/1268830572743102505/1394706549074821271/1394706549074821271"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Discord
                </a>
              </div>
            </div>
          </details>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <div style={{ fontWeight: 800 }}>Ty the Squirtle Squirt</div>
          <p style={{ marginTop: 6, color: "var(--text-muted)" }}>Revamped fishing guide and vibrant voyage guide.</p>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Show contributions</summary>
            <div
              style={{
                display: "grid",
                gap: 8,
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Revamped Fishing Guide</div>
                <a
                  className="linkButton"
                  href="https://discord.com/channels/1268830572743102505/1459511349951467541/1459511349951467541"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Discord
                </a>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Vibrant Voyage Guide</div>
                <a
                  className="linkButton"
                  href="https://discordapp.com/channels/1268830572743102505/1467051949076512984/1467051949076512984"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Discord
                </a>
              </div>
            </div>
          </details>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <div style={{ fontWeight: 800 }}>EpicJapan</div>
          <p style={{ marginTop: 6, color: "var(--text-muted)" }}>Summon Event guide.</p>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Show contributions</summary>
            <div
              style={{
                display: "grid",
                gap: 8,
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Summon Event Guide</div>
                <a
                  className="linkButton"
                  href="https://discord.com/channels/1268830572743102505/1375803689691779122/1375803689691779122"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Discord
                </a>
              </div>
            </div>
          </details>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <div style={{ fontWeight: 800 }}>Guide Images & Pricing Charts</div>
          <p style={{ marginTop: 6 }}>Thanks to Sebas for providing reference images (pricing charts, Trial Lv4, and more).</p>
        </div>
      </section>
    </AppShell>
  );
}
