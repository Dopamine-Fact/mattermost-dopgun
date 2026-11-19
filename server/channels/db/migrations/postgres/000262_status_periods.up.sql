CREATE TABLE IF NOT EXISTS StatusPeriods (
    Id VARCHAR(26) PRIMARY KEY,
    UserId VARCHAR(26) NOT NULL,
    Kind VARCHAR(16) NOT NULL,
    StartAt bigint NOT NULL,
    EndAt bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_statusperiods_userid_startat ON StatusPeriods (UserId, StartAt);
CREATE INDEX IF NOT EXISTS idx_statusperiods_startat ON StatusPeriods (StartAt);
