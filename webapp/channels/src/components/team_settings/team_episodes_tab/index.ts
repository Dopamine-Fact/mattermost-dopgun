// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {connect} from 'react-redux';
import type {ConnectedProps} from 'react-redux';
import {bindActionCreators} from 'redux';
import type {Dispatch} from 'redux';

import {patchTeam} from 'mattermost-redux/actions/teams';

import type {OwnProps} from 'components/team_settings/team_info_tab';

import TeamEpisodesTab from './team_episodes_tab';

export type {OwnProps};

function mapDispatchToProps(dispatch: Dispatch) {
    return {
        actions: bindActionCreators({patchTeam}, dispatch),
    };
}

const connector = connect(null, mapDispatchToProps);

export type PropsFromRedux = ConnectedProps<typeof connector>;

export default connector(TeamEpisodesTab);
