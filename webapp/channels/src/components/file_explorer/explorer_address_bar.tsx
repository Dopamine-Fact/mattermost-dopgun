// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {useIntl} from 'react-intl';
import {Link, useHistory} from 'react-router-dom';

import {ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChevronRightIcon, MagnifyIcon} from '@mattermost/compass-icons/components';

export type Crumb = {label: string; to: string};

type Props = {
    crumbs: Crumb[];
    upTo?: string;
    search: string;
    onSearch: (value: string) => void;
};

const ExplorerAddressBar = ({crumbs, upTo, search, onSearch}: Props) => {
    const intl = useIntl();
    const history = useHistory();
    const back = intl.formatMessage({id: 'file_explorer.back', defaultMessage: 'Back'});
    const forward = intl.formatMessage({id: 'file_explorer.forward', defaultMessage: 'Forward'});
    const up = intl.formatMessage({id: 'file_explorer.up', defaultMessage: 'Up'});
    const searchLabel = intl.formatMessage({id: 'file_explorer.search', defaultMessage: 'Search this folder'});

    return (
        <div className='ExplorerAddressBar'>
            <button
                type='button'
                aria-label={back}
                title={back}
                onClick={() => history.goBack()}
            >
                <ArrowLeftIcon size={18}/>
            </button>
            <button
                type='button'
                aria-label={forward}
                title={forward}
                onClick={() => history.goForward()}
            >
                <ArrowRightIcon size={18}/>
            </button>
            <button
                type='button'
                aria-label={up}
                title={up}
                disabled={!upTo}
                onClick={() => upTo && history.push(upTo)}
            >
                <ArrowUpIcon size={18}/>
            </button>
            <nav
                className='ExplorerAddressBar__crumbs'
                aria-label={intl.formatMessage({id: 'file_explorer.location', defaultMessage: 'Location'})}
            >
                {crumbs.map((crumb, i) => (
                    <React.Fragment key={crumb.to}>
                        {i > 0 && <ChevronRightIcon size={14}/>}
                        {i === crumbs.length - 1 ? <span aria-current='location'>{crumb.label}</span> : <Link to={crumb.to}>{crumb.label}</Link>}
                    </React.Fragment>
                ))}
            </nav>
            <label className='ExplorerAddressBar__search'>
                <MagnifyIcon size={16}/>
                <input
                    type='search'
                    value={search}
                    placeholder={searchLabel}
                    aria-label={searchLabel}
                    onChange={(e) => onSearch(e.target.value)}
                />
            </label>
        </div>
    );
};

export default ExplorerAddressBar;
