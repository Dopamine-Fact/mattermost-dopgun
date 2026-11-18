DROP TABLE IF EXISTS Departments;

DROP INDEX IF EXISTS idx_customroles_department_name;
DELETE FROM CustomRoles;
ALTER TABLE CustomRoles DROP COLUMN IF EXISTS TeamId;
ALTER TABLE CustomRoles DROP COLUMN IF EXISTS DepartmentId;
ALTER TABLE CustomRoles ADD COLUMN IF NOT EXISTS Department VARCHAR(64) NOT NULL DEFAULT '';

-- Ranks go with their table: retire the rk_ roles and take them off every member, as the up migration does for cr_.
UPDATE Roles SET DeleteAt = (extract(epoch from now()) * 1000)::bigint, UpdateAt = (extract(epoch from now()) * 1000)::bigint WHERE Name LIKE 'rk\_%' AND DeleteAt = 0;
UPDATE TeamMembers SET Roles = btrim(regexp_replace(regexp_replace(Roles, '(^|\s)rk_[a-z0-9]+(?=\s|$)', ' ', 'g'), '\s+', ' ', 'g')) WHERE Roles ~ '(^|\s)rk_[a-z0-9]+(?=\s|$)';

-- Shrink only when every value still fits; otherwise leave the wider column.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM TeamMembers WHERE length(Roles) > 256) THEN
        ALTER TABLE TeamMembers ALTER COLUMN Roles TYPE VARCHAR(256);
    END IF;
END $$;
