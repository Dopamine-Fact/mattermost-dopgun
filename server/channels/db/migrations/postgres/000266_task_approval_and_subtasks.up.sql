ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS ParentId varchar(26) NOT NULL DEFAULT '';
ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS ApprovalStatus varchar(32) NOT NULL DEFAULT '';
-- A done task counts as complete only once approved; tasks already done keep counting.
UPDATE Tasks SET ApprovalStatus = 'approved' WHERE Status = 'done' AND ApprovalStatus = '';
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS TaskApprovalEnabled boolean NOT NULL DEFAULT false;
