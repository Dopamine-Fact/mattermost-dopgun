-- At most one open period per user. An older duplicate (from a race) ends where the next one starts.
UPDATE StatusPeriods AS p
SET EndAt = (SELECT MIN(q.StartAt) FROM StatusPeriods q
             WHERE q.UserId = p.UserId AND q.EndAt = 0 AND q.Id <> p.Id
               AND (q.StartAt > p.StartAt OR (q.StartAt = p.StartAt AND q.Id > p.Id)))
WHERE p.EndAt = 0 AND EXISTS (
    SELECT 1 FROM StatusPeriods q
    WHERE q.UserId = p.UserId AND q.EndAt = 0 AND q.Id <> p.Id
      AND (q.StartAt > p.StartAt OR (q.StartAt = p.StartAt AND q.Id > p.Id)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_statusperiods_open_userid ON StatusPeriods (UserId) WHERE EndAt = 0;
