CREATE UNIQUE INDEX IF NOT EXISTS idx_driveitems_fileid_unique ON DriveItems (FileId) WHERE FileId <> '';
