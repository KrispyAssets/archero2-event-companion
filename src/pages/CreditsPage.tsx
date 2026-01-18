import AppShell from "../ui/AppShell";

export default function CreditsPage() {
  return (
    <AppShell>
      <h1>Credits</h1>
      <p>Thank you to the community members who inspired and informed this project.</p>

      <section style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <div style={{ fontWeight: 800 }}>Fishing Companion App</div>
          <p style={{ marginTop: 6 }}>
            Created by Kai&apos;thulhu.{" "}
            <a
              className="linkButton"
              href="https://ksun4176.github.io/archero2-fish-companion/"
              target="_blank"
              rel="noopener noreferrer"
            >
              View tool
            </a>
          </p>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          <div style={{ fontWeight: 800 }}>Fishing Guide</div>
          <p style={{ marginTop: 6 }}>
            Created by Ty the Squirtle Squirt.{" "}
            <a
              className="linkButton"
              href="https://discord.com/channels/1268830572743102505/1459511349951467541"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Discord
            </a>
          </p>
        </div>
      </section>
    </AppShell>
  );
}
