-- Classic credentials: local password hash (OAuth users keep NULL).
ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT NULL;
