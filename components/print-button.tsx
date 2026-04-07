"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print"
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 999,
        background: "#003366",
        color: "white",
        border: "none",
        padding: "8px 20px",
        borderRadius: 4,
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      Save as PDF
    </button>
  );
}
