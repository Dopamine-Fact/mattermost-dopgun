CREATE TABLE IF NOT EXISTS TaskStages (
	Id VARCHAR(26) PRIMARY KEY,
	TeamId VARCHAR(26) NOT NULL,
	SectionId VARCHAR(26) NOT NULL,
	Name VARCHAR(64) NOT NULL,
	SortOrder bigint NOT NULL DEFAULT 0,
	TaskIds text NOT NULL DEFAULT '[]',
	CreateAt bigint NOT NULL,
	UpdateAt bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_taskstages_teamid ON TaskStages (TeamId);
