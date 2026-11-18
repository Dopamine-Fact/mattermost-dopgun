DROP TABLE IF EXISTS Departments;

DROP INDEX IF EXISTS idx_customroles_department_name;
DELETE FROM CustomRoles;
ALTER TABLE CustomRoles DROP COLUMN IF EXISTS TeamId;
ALTER TABLE CustomRoles DROP COLUMN IF EXISTS DepartmentId;
ALTER TABLE CustomRoles ADD COLUMN IF NOT EXISTS Department VARCHAR(64) NOT NULL DEFAULT '';

-- Shrink only when every value still fits; otherwise leave the wider column.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM TeamMembers WHERE length(Roles) > 256) THEN
        ALTER TABLE TeamMembers ALTER COLUMN Roles TYPE VARCHAR(256);
    END IF;
END $$;
