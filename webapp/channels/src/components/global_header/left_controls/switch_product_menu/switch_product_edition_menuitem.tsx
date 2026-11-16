// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';

import {getLicense} from 'mattermost-redux/selectors/entities/general';

import * as Menu from 'components/menu';

import {LicenseLinks, LicenseSkus} from 'utils/constants';

export default function ProductSwitcherEditionFooter() {
    const license = useSelector(getLicense);

    const isLicensedVersion = license?.IsLicensed === 'true';
    const isEntrySKU = license?.SkuShortName === LicenseSkus.Entry;

    if (!isLicensedVersion || !isEntrySKU) {
        return null;
    }

    const badgeLabel = 'ENTRY EDITION';

    const label = (
        <FormattedMessage
            id='globalHeader.productSwitcherMenu.editionMenuitem.entry'
            defaultMessage='Entry offers Enterprise Advanced capabilities <b>with limits</b> designed to support evaluation. Learn more.'
            values={{
                b: (msg: React.ReactNode) => (
                    <b>
                        {msg}
                    </b>
                ),
            }}
        />
    );

    function handleClick() {
        window.open(LicenseLinks.ENTRY_LIMITS_INFO, '_blank', 'noopener,noreferrer');
    }

    return (
        <>
            <Menu.Separator/>
            <Menu.Item
                className='globalHeader-leftControls-productSwitcherMenu-editionMenuItem'
                labels={
                    <>
                        <span className='badgeLabel'>{badgeLabel}</span>
                        {label}
                    </>
                }
                onClick={handleClick}
            />
        </>
    );
}
