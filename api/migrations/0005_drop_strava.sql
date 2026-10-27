-- Strava retired: drop its stored OAuth tokens (other providers unaffected).
DELETE FROM accounts WHERE provider = 'strava';
