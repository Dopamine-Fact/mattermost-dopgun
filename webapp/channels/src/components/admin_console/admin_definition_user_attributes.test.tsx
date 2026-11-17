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

function isRedirectHidden(license: ClientLicense) {
    const subsection = AdminDefinition.system_attributes.subsections.user_attributes_redirect;
    const check = subsection.isHidden as Extract<Check, (...args: any[]) => boolean> | undefined;
    return check?.(config, {}, license, true, consoleAccess) ?? false;
}

describe('AdminDefinition - system_attributes/user_attributes always has a registered route', () => {
    // If this subsection is hidden the admin console has no route for the URL and
    // silently redirects elsewhere (admin_console.tsx's catch-all <Redirect>).
    test.each([
        ['unlicensed', unlicensed],
        ['below Enterprise', professionalLicense],
        ['Enterprise+', enterpriseLicense],
    ])('is visible when %s', (_name, license) => {
        expect(isRedirectHidden(license)).toBe(false);
    });
});
