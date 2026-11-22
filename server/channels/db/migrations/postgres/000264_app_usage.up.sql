CREATE TABLE IF NOT EXISTS AppUsage (
    Id VARCHAR(26) PRIMARY KEY,
    UserId VARCHAR(26) NOT NULL,
    App VARCHAR(128) NOT NULL,
    Title VARCHAR(512) NOT NULL,
    StartAt bigint NOT NULL,
    EndAt bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appusage_userid_startat ON AppUsage (UserId, StartAt);
CREATE INDEX IF NOT EXISTS idx_appusage_startat ON AppUsage (StartAt);
