// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AdminConfig, ClientLicense} from '@mattermost/types/config';

import {RESOURCE_KEYS} from 'mattermost-redux/constants/permissions_sysconsole';

import {LicenseSkus} from 'utils/constants';

import AdminDefinition from './admin_definition';
import type {AdminDefinitionSubSection, Check, ConsoleAccess} from './types';

const contentFlaggingConfigEnabled = {
    FeatureFlags: {
        ContentFlagging: true,
    },
} as unknown as Partial<AdminConfig>;

const contentFlaggingConfigDisabled = {
    FeatureFlags: {
        ContentFlagging: false,
    },
} as unknown as Partial<AdminConfig>;

const consoleAccess = {
    read: {
        [RESOURCE_KEYS.SITE.POSTS]: true,
        [RESOURCE_KEYS.USER_MANAGEMENT.SYSTEM_ROLES]: true,
    },
    write: {
        [RESOURCE_KEYS.SITE.POSTS]: true,
        [RESOURCE_KEYS.USER_MANAGEMENT.SYSTEM_ROLES]: true,
    },
} as ConsoleAccess;

const licenses: Array<[string, ClientLicense]> = [
    ['unlicensed', {IsLicensed: 'false'} as ClientLicense],
    ['Professional', {IsLicensed: 'true', SkuShortName: LicenseSkus.Professional} as ClientLicense],
    ['Enterprise Advanced', {IsLicensed: 'true', SkuShortName: LicenseSkus.EnterpriseAdvanced} as ClientLicense],
];

function isHidden(subsection: AdminDefinitionSubSection, config: Partial<AdminConfig>, license: ClientLicense, access = consoleAccess) {
    const check = subsection.isHidden as Extract<Check, (...args: any[]) => boolean>;
    return check(config, {}, license, true, access);
}

describe('AdminDefinition - Data Spillage', () => {
    const settingsSubsection = AdminDefinition.site.subsections.content_flagging;

    test('has no feature discovery twin or restricted indicator', () => {
        expect(AdminDefinition.site.subsections.content_flagging_feature_discovery).toBeUndefined();
        expect(settingsSubsection.restrictedIndicator).toBeUndefined();
    });

    test.each(licenses)('shows settings when the feature flag is on (%s)', (_, license) => {
        expect(isHidden(settingsSubsection, contentFlaggingConfigEnabled, license)).toBe(false);
    });

    test('hides settings when the Content Flagging feature flag is disabled', () => {
        expect(isHidden(settingsSubsection, contentFlaggingConfigDisabled, licenses[0][1])).toBe(true);
    });

    test('hides settings without system roles read access', () => {
        expect(isHidden(settingsSubsection, contentFlaggingConfigEnabled, licenses[0][1], {read: {}, write: {}} as ConsoleAccess)).toBe(true);
    });
});
