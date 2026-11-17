// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AdminConfig, ClientLicense} from '@mattermost/types/config';

import {LicenseSkus} from 'utils/constants';

import AdminDefinition from './admin_definition';
import type {Check, ConsoleAccess} from './types';

const config = {} as Partial<AdminConfig>;

const enterpriseLicense = {
    IsLicensed: 'true',
    SkuShortName: LicenseSkus.Enterprise,
} as ClientLicense;

const professionalLicense = {
    IsLicensed: 'true',
    SkuShortName: LicenseSkus.Professional,
} as ClientLicense;

const unlicensed = {
    IsLicensed: 'false',
} as ClientLicense;

const consoleAccess = {read: {}, write: {}} as ConsoleAccess;

function isHidden(config: Partial<AdminConfig>, license: ClientLicense) {
    const subsection = AdminDefinition.system_attributes.subsections.global_attributes;
    const check = subsection.isHidden as Extract<Check, (...args: any[]) => boolean> | undefined;
    return check?.(config, {}, license, true, consoleAccess) ?? false;
}

function isDisabled(isSystemAdmin: boolean) {
    const subsection = AdminDefinition.system_attributes.subsections.global_attributes;
    const check = subsection.isDisabled as Extract<Check, (...args: any[]) => boolean>;
    return check(config, {}, enterpriseLicense, true, consoleAccess, undefined, isSystemAdmin);
}

describe('AdminDefinition - Global Attributes access', () => {
    test.each([
        ['unlicensed', unlicensed],
        ['Professional', professionalLicense],
        ['Enterprise', enterpriseLicense],
    ])('is visible when %s', (_name, license) => {
        expect(isHidden(config, license)).toBe(false);
    });

    test('disables the page for non-sysadmins', () => {
        expect(isDisabled(true)).toBe(false);
        expect(isDisabled(false)).toBe(true);
    });
});
