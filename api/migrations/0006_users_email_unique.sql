-- One account per email: the register flow checks first, this wins races.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);
