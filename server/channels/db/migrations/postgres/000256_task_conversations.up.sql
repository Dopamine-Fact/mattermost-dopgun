-- A message in a task-list channel names its task in Props.task_id, and the task's comments are those messages.
-- Comments of tasks in a channel-linked section move into that channel as posts; channel-less tasks keep TaskComments.

CREATE INDEX IF NOT EXISTS idx_tasksections_channelid ON TaskSections (ChannelId) WHERE ChannelId <> '';

-- Revision comments were also echoed into the channel as "Comment on [title](...revision=<task>)" posts by the
-- commenter, right after the comment was saved. The comment becomes the post itself, so its echo is deleted: at most
-- one per comment, the first matching post within 5 s of it.
UPDATE Posts
SET DeleteAt = (extract(epoch from now()) * 1000)::bigint,
    UpdateAt = (extract(epoch from now()) * 1000)::bigint
WHERE Id IN (
    SELECT DISTINCT ON (tc.Id) p.Id
    FROM TaskComments tc
    JOIN Tasks t ON t.Id = tc.TaskId
    JOIN TaskSections ts ON ts.Id = t.SectionId AND ts.ChannelId <> ''
    JOIN Posts p ON p.ChannelId = ts.ChannelId
        AND p.UserId = tc.UserId
        AND p.Type = ''
        AND p.DeleteAt = 0
        AND p.CreateAt BETWEEN tc.CreateAt AND tc.CreateAt + 5000
        -- No question mark here: sqlx rebinds it to a placeholder even inside a literal. A task id is 26 random
        -- characters, so "revision=<id>" is as specific as the full link.
        AND p.Message LIKE '%revision=' || t.Id || '%'
    -- An echo someone replied to stays, so its thread keeps its root.
    WHERE NOT EXISTS (SELECT 1 FROM Posts r WHERE r.RootId = p.Id AND r.DeleteAt = 0)
    ORDER BY tc.Id, p.CreateAt
);

-- Each comment becomes a root post with a stable id, so a re-run inserts nothing twice. The channel and its members'
-- message counts grow together, so nobody gets unread messages from history.
WITH inserted AS (
    INSERT INTO Posts (Id, CreateAt, UpdateAt, EditAt, DeleteAt, IsPinned, UserId, ChannelId, RootId, OriginalId,
                       Message, Type, Props, Hashtags, Filenames, FileIds, HasReactions)
    SELECT substr(md5(tc.Id || ':post'), 1, 26), tc.CreateAt, tc.CreateAt, 0, 0, false, tc.UserId, ts.ChannelId, '', '',
           tc.Message, '', jsonb_build_object('task_id', t.Id), '', '[]', tc.FileIds, false
    FROM TaskComments tc
    JOIN Tasks t ON t.Id = tc.TaskId
    JOIN TaskSections ts ON ts.Id = t.SectionId AND ts.ChannelId <> ''
    ON CONFLICT (Id) DO NOTHING
    RETURNING ChannelId
), counts AS (
    SELECT ChannelId, count(*) AS n FROM inserted GROUP BY ChannelId
), channels AS (
    UPDATE Channels c
    SET TotalMsgCount = c.TotalMsgCount + counts.n, TotalMsgCountRoot = c.TotalMsgCountRoot + counts.n
    FROM counts
    WHERE c.Id = counts.ChannelId
)
UPDATE ChannelMembers cm
SET MsgCount = cm.MsgCount + counts.n, MsgCountRoot = cm.MsgCountRoot + counts.n
FROM counts
WHERE cm.ChannelId = counts.ChannelId;

UPDATE FileInfo fi
SET PostId = substr(md5(tc.Id || ':post'), 1, 26), ChannelId = ts.ChannelId
FROM TaskComments tc
JOIN Tasks t ON t.Id = tc.TaskId
JOIN TaskSections ts ON ts.Id = t.SectionId AND ts.ChannelId <> ''
CROSS JOIN LATERAL jsonb_array_elements_text(tc.FileIds::jsonb) AS f(id)
WHERE fi.Id = f.id;

DELETE FROM TaskComments tc
USING Tasks t, TaskSections ts
WHERE t.Id = tc.TaskId AND ts.Id = t.SectionId AND ts.ChannelId <> '';
