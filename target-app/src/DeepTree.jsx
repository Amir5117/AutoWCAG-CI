// DeepTree.jsx
// AST Boundary Trap fixture for AutoWCAG-CI
// Deep nesting + Fragments + ternaries + map; violation buried in mapped item

import React from "react";

const SECTIONS = [
  {
    id: "alpha",
    title: "Primary",
    items: [
      { id: "a1", label: "Alpha One", tone: "ok" },
      { id: "a2", label: "Alpha Two", tone: "warn" },
    ],
  },
  {
    id: "beta",
    title: "Secondary",
    items: [
      { id: "b1", label: "Beta One", tone: "ok" },
      {
        id: "b2",
        label: "Beta Two",
        tone: "critical",
        media: { src: "/assets/alert-badge.png", kind: "badge" },
      },
      { id: "b3", label: "Beta Three", tone: "ok" },
    ],
  },
  {
    id: "gamma",
    title: "Tertiary",
    items: [{ id: "g1", label: "Gamma One", tone: "ok" }],
  },
];

function ToneDot({ tone }) {
  return (
    <span
      className="tone-dot"
      style={{
        backgroundColor:
          tone === "critical" ? "#ff4444" : tone === "warn" ? "#ffaa00" : "#22cc66",
        color: tone === "critical" ? "#ffcccc" : "#ffffff",
        fontSize: 10,
        padding: "2px 6px",
      }}
    >
      {tone}
    </span>
  );
}

export default function DeepTree({ mode = "full", highlightId }) {
  const showMeta = mode === "full" || mode === "meta";

  return (
    <div className="deep-tree-root">
      <>
        <header>
          <h2>Nested Inventory</h2>
          {showMeta ? (
            <p className="meta">Mode: {mode}</p>
          ) : (
            <p className="meta muted">Compact mode</p>
          )}
        </header>

        <section className="sections">
          {SECTIONS.map((section) => (
            <React.Fragment key={section.id}>
              <div className="section-block">
                <h3>{section.title}</h3>

                <>
                  {section.items && section.items.length > 0 ? (
                    <ul className="item-list">
                      {section.items.map((item) => (
                        <li
                          key={item.id}
                          className={
                            highlightId === item.id ? "item highlighted" : "item"
                          }
                        >
                          {item.tone === "critical" ? (
                            <div className="critical-row">
                              <ToneDot tone={item.tone} />
                              <span className="label">{item.label}</span>
                              {item.media ? (
                                <span className="media-slot">
                                  <img
                                    src={item.media.src}
                                    width={24}
                                    height={24}
                                    className="inline-badge"
                                  />
                                </span>
                              ) : null}
                            </div>
                          ) : item.tone === "warn" ? (
                            <>
                              <ToneDot tone={item.tone} />
                              <span className="label">{item.label}</span>
                            </>
                          ) : (
                            <span className="label plain">{item.label}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">No items</p>
                  )}
                </>
              </div>
            </React.Fragment>
          ))}
        </section>

        {mode === "full" ? (
          <footer>
            <>
              <small>
                Generated tree · {SECTIONS.reduce((n, s) => n + s.items.length, 0)} nodes
              </small>
            </>
          </footer>
        ) : null}
      </>
    </div>
  );
}
