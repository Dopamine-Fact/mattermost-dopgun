DROP TABLE IF EXISTS DailyReportAssignees;

DROP INDEX IF EXISTS idx_dailyreports_status_updateat;
CREATE INDEX IF NOT EXISTS idx_dailyreports_status_createat ON DailyReports (Status, CreateAt);

-- v1 has no rejected status: send rejected reports back to pending before their reason columns go.
UPDATE DailyReports SET Status = 'pending' WHERE Status = 'rejected';

ALTER TABLE DailyReports DROP COLUMN IF EXISTS RejectReason;
ALTER TABLE DailyReports DROP COLUMN IF EXISTS RejectedAt;
ALTER TABLE DailyReports DROP COLUMN IF EXISTS RejectedBy;
ALTER TABLE DailyReports DROP COLUMN IF EXISTS PreviousMessage;
ALTER TABLE DailyReports DROP COLUMN IF EXISTS Edited;
