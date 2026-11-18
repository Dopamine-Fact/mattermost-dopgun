CREATE TABLE IF NOT EXISTS Departments (
    Id VARCHAR(26) PRIMARY KEY,
    TeamId VARCHAR(26) NOT NULL,
    Name VARCHAR(64) NOT NULL,
    Color VARCHAR(7) NOT NULL,
    Position integer NOT NULL,
    IsStudio boolean NOT NULL DEFAULT false,
    CreateAt bigint,
    UpdateAt bigint,
    DeleteAt bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_team_name ON Departments (TeamId, lower(Name)) WHERE DeleteAt = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_team_studio ON Departments (TeamId) WHERE IsStudio AND DeleteAt = 0;

-- Phase 1 system-wide custom roles have no team or department; they are dropped, not migrated.
DELETE FROM CustomRoles;
ALTER TABLE CustomRoles DROP COLUMN IF EXISTS Department;
ALTER TABLE CustomRoles ADD COLUMN IF NOT EXISTS TeamId VARCHAR(26) NOT NULL;
ALTER TABLE CustomRoles ADD COLUMN IF NOT EXISTS DepartmentId VARCHAR(26) NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customroles_department_name ON CustomRoles (DepartmentId, lower(DisplayName)) WHERE DeleteAt = 0;

UPDATE Roles SET DeleteAt = (extract(epoch from now()) * 1000)::bigint, UpdateAt = (extract(epoch from now()) * 1000)::bigint WHERE Name LIKE 'cr\_%' AND DeleteAt = 0;
UPDATE Users SET Roles = btrim(regexp_replace(regexp_replace(Roles, '(^|\s)cr_[a-z0-9]+(?=\s|$)', ' ', 'g'), '\s+', ' ', 'g')) WHERE Roles ~ '(^|\s)cr_[a-z0-9]+(?=\s|$)';
UPDATE Sessions SET Roles = btrim(regexp_replace(regexp_replace(Roles, '(^|\s)cr_[a-z0-9]+(?=\s|$)', ' ', 'g'), '\s+', ' ', 'g')) WHERE Roles ~ '(^|\s)cr_[a-z0-9]+(?=\s|$)';

ALTER TABLE TeamMembers ALTER COLUMN Roles TYPE VARCHAR(1024);
