ALTER TABLE teams ADD COLUMN IF NOT EXISTS canvasenabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS canvases (channelid varchar(26) PRIMARY KEY, teamid varchar(26) NOT NULL, creatorid varchar(26) NOT NULL,
  lastseq bigint NOT NULL DEFAULT 0, snapshotseq bigint NOT NULL DEFAULT 0, snapshotdata bytea, createat bigint NOT NULL, updateat bigint NOT NULL);
CREATE TABLE IF NOT EXISTS canvasupdates (channelid varchar(26) NOT NULL, seq bigint NOT NULL, userid varchar(26) NOT NULL,
  data bytea NOT NULL, createat bigint NOT NULL, PRIMARY KEY (channelid, seq));
