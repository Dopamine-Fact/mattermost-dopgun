CREATE TABLE IF NOT EXISTS TaskComments (
	Id VARCHAR(26) PRIMARY KEY,
	TaskId VARCHAR(26) NOT NULL,
	UserId VARCHAR(26) NOT NULL,
	Message VARCHAR(16000) NOT NULL DEFAULT '',
	FileIds VARCHAR(300) NOT NULL DEFAULT '[]',
	CreateAt bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_taskcomments_taskid_createat ON TaskComments (TaskId, CreateAt);
