ALTER TABLE profiles ADD COLUMN github_user_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_github_user_id_idx
  ON profiles(github_user_id)
  WHERE github_user_id IS NOT NULL;
