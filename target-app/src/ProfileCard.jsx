// Simple profile card for AutoWCAG-CI's live demo.
// Intentionally contains exactly 1 WCAG 2.1 AA violation for the scanner
// to detect:
//   1. <img> with no alt text -> axe rule: image-alt
function ProfileCard({ name = "Jordan Lee", title = "Product Designer" }) {
  return (
    <div className="profile-card">
      <img src="/avatar.png" className="profile-pic" />

      <div className="profile-info">
        <h2 className="profile-name">{name}</h2>
        <p className="profile-title">{title}</p>
      </div>
    </div>
  );
}

export default ProfileCard;
