DROP TABLE IF EXISTS DailyReportFiles;

-- Earlier versions know neither status: drop the unsent drafts and the excused days.
DELETE FROM DailyReports WHERE Status IN ('draft', 'excused');
