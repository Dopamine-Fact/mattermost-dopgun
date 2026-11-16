ALTER TABLE Teams ADD COLUMN IF NOT EXISTS DailyReportsEnabled boolean NOT NULL DEFAULT false;
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS DailyReportTime VARCHAR(5) NOT NULL DEFAULT '18:00';
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS DailyReportTimezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul';

CREATE TABLE IF NOT EXISTS DailyReports (
    Id VARCHAR(26) PRIMARY KEY,
    TeamId VARCHAR(26) NOT NULL,
    UserId VARCHAR(26) NOT NULL,
    Date VARCHAR(10) NOT NULL,
    Message VARCHAR(16000) NOT NULL DEFAULT '',
    Tasks jsonb NOT NULL DEFAULT '[]',
    Status VARCHAR(16) NOT NULL DEFAULT 'pending',
    AutoApproved boolean NOT NULL DEFAULT false,
    ApprovedBy VARCHAR(26) NOT NULL DEFAULT '',
    ApprovedAt bigint NOT NULL DEFAULT 0,
    CreateAt bigint NOT NULL,
    UpdateAt bigint NOT NULL,
    UNIQUE (TeamId, UserId, Date)
);

CREATE INDEX IF NOT EXISTS idx_dailyreports_team_date ON DailyReports (TeamId, Date);
CREATE INDEX IF NOT EXISTS idx_dailyreports_status_createat ON DailyReports (Status, CreateAt);
