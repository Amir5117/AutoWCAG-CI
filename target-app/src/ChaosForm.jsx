// ChaosForm.jsx
// Collision & Ambiguity Test fixture for AutoWCAG-CI
// Contains: missing image-alt, icon-only button-name, disconnected label/input

import React, { useState } from "react";

export default function ChaosForm({ onSubmit, user }) {
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit?.({ email, accepted });
  };

  return (
    <div className="chaos-form-wrapper" data-testid="chaos-root">
      <header className="hero">
        <img
          src="/assets/promo-banner.png"
          width={640}
          height={180}
          className="hero-banner"
        />
        <div className="hero-actions">
          <button type="button" className="icon-btn" onClick={() => window.history.back()}>
            <span aria-hidden="true">←</span>
          </button>
        </div>
      </header>

      <main>
        <h1>Checkout Preferences</h1>

        <form onSubmit={handleSubmit} className="nested-form">
          <div className="layout-row">
            <div className="col-left">
              <div className="field-group">
                <div className="label-shell">
                  <div className="label-inner">
                    <label>Email address</label>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-right">
              <div className="control-shell">
                <div className="control-inner">
                  <div className="input-wrap">
                    <input
                      type="email"
                      name="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="extras">
            <div>
              <div>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
              </div>
            </div>
          </div>

          <div className="actions">
            <button type="submit">Continue</button>
            <button type="button" className="ghost-icon" title="">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
        </form>

        {user && (
          <aside className="profile-chip">
            <img src={user.avatarUrl || "/avatar-fallback.png"} className="avatar" />
            <span>{user.name || "Guest"}</span>
          </aside>
        )}
      </main>
    </div>
  );
}

// Triggering final sandbox validation test
// Triggering run with synchronize support
