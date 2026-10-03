function ProfileCard() {
  return (
    <article className="profile-card">
      <img src="/avatar.png" className="w-16 h-16 rounded-full" />

      <div className="profile-info">
        <h2 className="profile-name">Jordan Lee</h2>
        <p className="profile-title">Product Designer</p>
      </div>
    </article>
  );
}

export default ProfileCard;
