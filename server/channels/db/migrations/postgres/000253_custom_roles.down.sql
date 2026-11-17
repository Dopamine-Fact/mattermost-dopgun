DROP TABLE IF EXISTS CustomRoles;

-- Shrink only when every value still fits; otherwise leave the wider column.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Users WHERE length(Roles) > 256) THEN
        ALTER TABLE Users ALTER COLUMN Roles TYPE VARCHAR(256);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM Sessions WHERE length(Roles) > 256) THEN
        ALTER TABLE Sessions ALTER COLUMN Roles TYPE VARCHAR(256);
    END IF;
END $$;
