"use client";

export function PrintButton() {
  return (
    <div className="no-print" style={{ padding: "8px 20px", textAlign: "right", background: "#f1f5f9" }}>
      <button
        onClick={() => window.print()}
        style={{
          background: "#003366",
          color: "white",
          border: "none",
          padding: "6px 18px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Save as PDF
      </button>
    </div>
  );
}
