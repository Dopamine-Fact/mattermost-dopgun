-- morph:nontransactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_task_id ON Posts ((Props->>'task_id'), CreateAt) WHERE DeleteAt = 0 AND Props->>'task_id' IS NOT NULL;
