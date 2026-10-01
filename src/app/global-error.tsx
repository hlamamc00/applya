"use client";

// The last resort when even the root layout fails to render.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f6f5f1", color: "#0e1a3a", margin: 0 }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28 }}>Something went wrong</h1>
          <p style={{ color: "#60737b" }}>Reload the page to carry on. Nothing you saved has been lost.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ background: "#0e1a3a", color: "#fff", border: 0, borderRadius: 6, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>
            Reload
          </button>
          {error.digest && <p style={{ fontSize: 12, color: "#9aa8ae", marginTop: 32 }}>Reference {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
