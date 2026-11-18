-- morph:nontransactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driveitems_mirrorof ON DriveItems (ChannelId, MirrorOf) WHERE MirrorOf <> '' AND DeleteAt = 0;
