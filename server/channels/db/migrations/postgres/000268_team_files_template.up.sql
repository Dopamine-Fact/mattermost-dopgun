ALTER TABLE Teams ADD COLUMN IF NOT EXISTS FilesTemplate text NOT NULL DEFAULT '';
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS FilesChannelId varchar(26) NOT NULL DEFAULT '';
ALTER TABLE Departments ADD COLUMN IF NOT EXISTS LibraryWrite boolean NOT NULL DEFAULT false;
ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS LibraryFolderId varchar(26) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tasks_libraryfolderid ON Tasks (LibraryFolderId) WHERE LibraryFolderId <> '';

CREATE TABLE IF NOT EXISTS DriveShares (
    ItemId varchar(26) NOT NULL,
    TeamId varchar(26) NOT NULL,
    CreatorId varchar(26) NOT NULL,
    CreateAt bigint NOT NULL,
    PRIMARY KEY (ItemId, TeamId)
);

CREATE INDEX IF NOT EXISTS idx_driveshares_teamid ON DriveShares (TeamId);
