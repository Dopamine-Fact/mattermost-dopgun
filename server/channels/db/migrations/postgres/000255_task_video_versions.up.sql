CREATE TABLE IF NOT EXISTS TaskSectionVideos (
    Id VARCHAR(26) PRIMARY KEY,
    SectionId VARCHAR(26) NOT NULL,
    FileId VARCHAR(26) NOT NULL,
    Version integer NOT NULL,
    CreatorId VARCHAR(26) NOT NULL,
    CreateAt bigint NOT NULL,
    UNIQUE (SectionId, Version)
);

ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS VideoFileId VARCHAR(26) NOT NULL DEFAULT '';
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS EpisodeFolders text NOT NULL DEFAULT '';
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS EpisodeTasks text NOT NULL DEFAULT '';

-- Each existing section video becomes version 1, credited to its uploader.
INSERT INTO TaskSectionVideos (Id, SectionId, FileId, Version, CreatorId, CreateAt)
SELECT substr(md5(ts.Id || ':v1'), 1, 26), ts.Id, ts.VideoFileId, 1, fi.CreatorId, fi.CreateAt
FROM TaskSections ts
JOIN FileInfo fi ON fi.Id = ts.VideoFileId
WHERE ts.VideoFileId <> ''
ON CONFLICT (SectionId, Version) DO NOTHING;

-- A task is a revision only if its revision card was posted in the section's channel; other tasks stay ordinary.
UPDATE Tasks t
SET VideoFileId = ts.VideoFileId
FROM TaskSections ts
WHERE t.SectionId = ts.Id
  AND ts.VideoFileId <> ''
  AND t.VideoFileId = ''
  AND EXISTS (
    SELECT 1 FROM Posts p
    WHERE p.ChannelId = ts.ChannelId
      AND p.Type = 'custom_revision'
      AND p.Props->>'task_id' = t.Id
  );
