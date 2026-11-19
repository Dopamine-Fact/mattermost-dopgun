CREATE TABLE IF NOT EXISTS DailyReportFiles (
    ReportId VARCHAR(26) NOT NULL,
    FileId VARCHAR(26) NOT NULL,
    CreateAt bigint NOT NULL,
    PRIMARY KEY (ReportId, FileId)
);

CREATE INDEX IF NOT EXISTS idx_dailyreportfiles_fileid ON DailyReportFiles (FileId);
