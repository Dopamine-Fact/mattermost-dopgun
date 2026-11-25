ALTER TABLE Teams ADD COLUMN IF NOT EXISTS NotesEnabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS PersonalNotes (
    Id varchar(26) PRIMARY KEY,
    TeamId varchar(26) NOT NULL,
    UserId varchar(26) NOT NULL,
    Title varchar(256) NOT NULL,
    Message text NOT NULL DEFAULT '',
    Visibility varchar(16) NOT NULL,
    Date varchar(10) NOT NULL DEFAULT '',
    Time varchar(5) NOT NULL DEFAULT '',
    RemindMinutes integer NOT NULL DEFAULT -1,
    RemindAt bigint NOT NULL DEFAULT 0,
    DoneAt bigint NOT NULL DEFAULT 0,
    CreateAt bigint NOT NULL,
    UpdateAt bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personalnotes_team_date ON PersonalNotes (TeamId, Date);
CREATE INDEX IF NOT EXISTS idx_personalnotes_team_user ON PersonalNotes (TeamId, UserId);
CREATE INDEX IF NOT EXISTS idx_personalnotes_remindat ON PersonalNotes (RemindAt) WHERE RemindAt > 0;
