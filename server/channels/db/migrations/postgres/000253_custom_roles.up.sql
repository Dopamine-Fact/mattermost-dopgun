CREATE TABLE IF NOT EXISTS CustomRoles (
    Id VARCHAR(26) PRIMARY KEY,
    RoleName VARCHAR(64) NOT NULL,
    DisplayName VARCHAR(64) NOT NULL,
    Color VARCHAR(7) NOT NULL,
    Position integer NOT NULL,
    Department VARCHAR(64) NOT NULL DEFAULT '',
    CreateAt bigint,
    UpdateAt bigint,
    DeleteAt bigint NOT NULL DEFAULT 0
);

ALTER TABLE Users ALTER COLUMN Roles TYPE VARCHAR(1024);
ALTER TABLE Sessions ALTER COLUMN Roles TYPE VARCHAR(1024);
