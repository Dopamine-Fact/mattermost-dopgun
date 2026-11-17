// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import AdminDefinition from './admin_definition';
import type {AdminDefinitionSetting} from './types';

describe('AdminDefinition - Backups page', () => {
    const section = AdminDefinition.environment.subsections.backups;
    const schema = section?.schema;
    const settings: AdminDefinitionSetting[] = (schema && 'settings' in schema && schema.settings) ? schema.settings : [];

    test('is backed by BackupSettings', () => {
        expect(section?.url).toBe('environment/backups');
        expect(schema?.id).toBe('BackupSettings');
    });

    test('has a Back up now jobs table for the backup job', () => {
        const table = settings.find((s) => s.type === 'jobstable');
        expect(table).toBeDefined();
        expect(table && 'job_type' in table && table.job_type).toBe('backup');
    });

    test('lists every BackupSettings field in order', () => {
        const keys = settings.map((s) => s.key).filter(Boolean);
        expect(keys).toEqual([
            'BackupSettings.Enable',
            'BackupSettings.DailyRunTime',
            'BackupSettings.RetentionDays',
            'BackupSettings.AmazonS3Bucket',
            'BackupSettings.AmazonS3PathPrefix',
            'BackupSettings.AmazonS3Region',
            'BackupSettings.AmazonS3AccessKeyId',
            'BackupSettings.AmazonS3SecretAccessKey',
            'BackupSettings.AmazonS3Endpoint',
            'BackupSettings.AmazonS3SSL',
            'BackupSettings.AmazonS3SSE',
        ]);
    });
});
