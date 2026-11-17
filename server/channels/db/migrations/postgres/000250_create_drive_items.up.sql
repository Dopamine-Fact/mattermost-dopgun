ALTER TABLE Teams ADD COLUMN IF NOT EXISTS FilesEnabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS DriveItems (
    Id VARCHAR(26) PRIMARY KEY,
    ChannelId VARCHAR(26) NOT NULL,
    ParentId VARCHAR(26) NOT NULL DEFAULT '',
    Type VARCHAR(16) NOT NULL,
    Name VARCHAR(256) NOT NULL,
    FileId VARCHAR(26) NOT NULL DEFAULT '',
    CreatorId VARCHAR(26) NOT NULL,
    CreateAt bigint NOT NULL,
    UpdateAt bigint NOT NULL,
    DeleteAt bigint NOT NULL DEFAULT 0,
    DeletedBy VARCHAR(26) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_driveitems_channel_parent_delete ON DriveItems (ChannelId, ParentId, DeleteAt);
CREATE INDEX IF NOT EXISTS idx_driveitems_fileid ON DriveItems (FileId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driveitems_live_name ON DriveItems (ChannelId, ParentId, lower(Name)) WHERE DeleteAt = 0;
