ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS Done boolean NOT NULL DEFAULT false;

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'status') THEN
		UPDATE Tasks SET Done = (Status = 'done');
	END IF;
END $$;

ALTER TABLE Tasks DROP COLUMN IF EXISTS Status;
ALTER TABLE Tasks DROP COLUMN IF EXISTS SortOrder;
ALTER TABLE Tasks DROP COLUMN IF EXISTS StartAt;
