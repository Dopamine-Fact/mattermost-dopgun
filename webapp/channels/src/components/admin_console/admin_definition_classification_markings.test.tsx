// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AdminConfig, ClientLicense} from '@mattermost/types/config';

import {LicenseSkus} from 'utils/constants';

import AdminDefinition from './admin_definition';
import type {AdminDefinitionSubSection, Check, ConsoleAccess} from './types';

const classificationConfigEnabled = {
    FeatureFlags: {
        ClassificationMarkings: true,
    },
} as unknown as Partial<AdminConfig>;

const classificationConfigDisabled = {
    FeatureFlags: {
        ClassificationMarkings: false,
    },
} as unknown as Partial<AdminConfig>;

const consoleAccess = {read: {}, write: {}} as ConsoleAccess;

const licenses: Array<[string, ClientLicense]> = [
    ['unlicensed', {IsLicensed: 'false'} as ClientLicense],
    ['Professional', {IsLicensed: 'true', SkuShortName: LicenseSkus.Professional} as ClientLicense],
    ['Enterprise', {IsLicensed: 'true', SkuShortName: LicenseSkus.Enterprise} as ClientLicense],
    ['Enterprise Advanced', {IsLicensed: 'true', SkuShortName: LicenseSkus.EnterpriseAdvanced} as ClientLicense],
];

function isHidden(subsection: AdminDefinitionSubSection, config: Partial<AdminConfig>, license: ClientLicense) {
    const check = subsection.isHidden as Extract<Check, (...args: any[]) => boolean>;
    return check(config, {}, license, true, consoleAccess);
}

describe('AdminDefinition - Classification Markings', () => {
    const settingsSubsection = AdminDefinition.site.subsections.classification_markings;

    test('has no feature discovery twin or restricted indicator', () => {
        expect(AdminDefinition.site.subsections.classification_markings_feature_discovery).toBeUndefined();
        expect(settingsSubsection.restrictedIndicator).toBeUndefined();
    });

    test.each(licenses)('shows settings when the feature flag is on (%s)', (_, license) => {
        expect(isHidden(settingsSubsection, classificationConfigEnabled, license)).toBe(false);
    });

    test.each(licenses)('hides settings when the feature flag is off (%s)', (_, license) => {
        expect(isHidden(settingsSubsection, classificationConfigDisabled, license)).toBe(true);
    });

    test('disables the settings page for non system admins', () => {
        const settingsDisabledCheck = settingsSubsection.isDisabled as Extract<Check, (...args: any[]) => boolean>;

        expect(settingsDisabledCheck(classificationConfigEnabled, {}, licenses[0][1], true, consoleAccess, undefined, true)).toBe(false);
        expect(settingsDisabledCheck(classificationConfigEnabled, {}, licenses[0][1], true, consoleAccess, undefined, false)).toBe(true);
    });
});
