ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS Status VARCHAR(16) NOT NULL DEFAULT 'todo';
ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS SortOrder double precision NOT NULL DEFAULT 0;
ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS StartAt bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'done') THEN
		UPDATE Tasks SET Status = 'done' WHERE Done;
		ALTER TABLE Tasks DROP COLUMN Done;
	END IF;
END $$;

UPDATE Tasks SET SortOrder = CreateAt WHERE SortOrder = 0;
