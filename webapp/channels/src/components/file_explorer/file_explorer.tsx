// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Redirect} from 'react-router-dom';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {selectLhsItem} from 'actions/views/lhs';

import {LhsItemType, LhsPage} from 'types/store/lhs';

const FileExplorer = () => {
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Files));
    }, [dispatch]);

    if (team && !team.files_enabled) {
        return <Redirect to={`/${team.name}`}/>;
    }

    return (
        <div className='FileExplorer app__content'>
            <h1>
                <FormattedMessage
                    id='file_explorer.title'
                    defaultMessage='Files'
                />
            </h1>
        </div>
    );
};

export default FileExplorer;
