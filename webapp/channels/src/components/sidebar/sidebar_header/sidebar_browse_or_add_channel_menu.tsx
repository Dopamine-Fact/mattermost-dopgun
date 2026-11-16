// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {type JSX} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {
    PlusIcon,
    AccountPlusOutlineIcon,
    FolderPlusOutlineIcon,
    AccountMultiplePlusOutlineIcon,
    GlobeIcon,
    AccountOutlineIcon,
    PlayBoxMultipleOutlineIcon,
    PencilOutlineIcon,
} from '@mattermost/compass-icons/components';
import {Icon} from '@mattermost/compass-ui/components/icon';

import {Permissions} from 'mattermost-redux/constants';
import {haveICurrentTeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentTeam, getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';

import {openModal} from 'actions/views/modals';
import {getSidebarBrowseOrAddChannelMenuPluginComponents} from 'selectors/plugins';

import CanvasChannelModal from 'components/canvas/canvas_channel_modal';
import * as Menu from 'components/menu';
import RevisionChannelModal from 'components/tasks/revision_channel_modal';
import {OnboardingTourSteps} from 'components/tours';
import {useShowOnboardingTutorialStep, CreateAndJoinChannelsTour, InvitePeopleTour} from 'components/tours/onboarding_tour';

import {ModalIdentifiers} from 'utils/constants';

import type {GlobalState} from 'types/store';
import type {SidebarBrowseOrAddChannelMenuAction} from 'types/store/plugins';

export const ELEMENT_ID_FOR_BROWSE_OR_ADD_CHANNEL_MENU = 'browserOrAddChannelMenu';
export const ELEMENT_ID_FOR_BROWSE_OR_ADD_CHANNEL_MENU_BUTTON = 'browseOrAddChannelMenuButton';

const BrowseOrAddChannelMenuTrigger = Menu.createMenuIconButtonTrigger({
    size: 'small',
    style: 'inverted',
    rounded: true,
    className: 'browseOrAddChannelMenuTrigger',
});

type Props = {
    canCreateChannel: boolean;
    onCreateNewChannelClick: () => void;
    canJoinPublicChannel: boolean;
    onBrowseChannelClick: () => void;
    onOpenDirectMessageClick: () => void;
    canCreateCustomGroups: boolean;
    onCreateNewUserGroupClick: () => void;
    unreadFilterEnabled: boolean;
    onCreateNewCategoryClick: () => void;
    onInvitePeopleClick: () => void;
};

export default function SidebarBrowserOrAddChannelMenu(props: Props) {
    const {formatMessage} = useIntl();
    const currentTeamId = useSelector(getCurrentTeamId);
    const pluginMenuItems = useSelector(getSidebarBrowseOrAddChannelMenuPluginComponents);
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const canManageTasks = useSelector((state: GlobalState) => haveICurrentTeamPermission(state, Permissions.MANAGE_TEAM_TASKS));

    const canCreatePublicChannel = useSelector((state: GlobalState) => haveICurrentTeamPermission(state, Permissions.CREATE_PUBLIC_CHANNEL));

    const showCreateAndJoinChannelsTutorialTip = useShowOnboardingTutorialStep(OnboardingTourSteps.CREATE_AND_JOIN_CHANNELS);
    const showInvitePeopleTutorialTip = useShowOnboardingTutorialStep(OnboardingTourSteps.INVITE_PEOPLE);

    let createNewChannelMenuItem: JSX.Element | null = null;
    if (props.canCreateChannel) {
        createNewChannelMenuItem = (
            <Menu.Item
                id='createNewChannelMenuItem'
                onClick={props.onCreateNewChannelClick}
                leadingElement={<PlusIcon size={18}/>}
                labels={(
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.createNewChannelMenuItem.primaryLabel'
                        defaultMessage='Create new channel'
                    />
                )}
                trailingElements={showCreateAndJoinChannelsTutorialTip && <CreateAndJoinChannelsTour/>}
                aria-haspopup='true'
            />
        );
    }

    let createRevisionChannelMenuItem: JSX.Element | null = null;
    if (team?.tasks_enabled && team.revisions_enabled && canManageTasks) {
        createRevisionChannelMenuItem = (
            <Menu.Item
                id='createRevisionChannelMenuItem'
                onClick={() => dispatch(openModal({modalId: ModalIdentifiers.REVISION_CHANNEL_MODAL, dialogType: RevisionChannelModal}))}
                leadingElement={<PlayBoxMultipleOutlineIcon size={18}/>}
                labels={(
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.createRevisionChannelMenuItem.primaryLabel'
                        defaultMessage='Create revision channel'
                    />
                )}
                aria-haspopup='true'
            />
        );
    }

    let createCanvasChannelMenuItem: JSX.Element | null = null;
    if (team?.canvas_enabled && canCreatePublicChannel) {
        createCanvasChannelMenuItem = (
            <Menu.Item
                id='createCanvasChannelMenuItem'
                onClick={() => dispatch(openModal({modalId: ModalIdentifiers.CANVAS_CHANNEL_MODAL, dialogType: CanvasChannelModal}))}
                leadingElement={<PencilOutlineIcon size={18}/>}
                labels={(
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.createCanvasChannelMenuItem.primaryLabel'
                        defaultMessage='Create canvas channel'
                    />
                )}
                aria-haspopup='true'
            />
        );
    }

    let browseChannelsMenuItem: JSX.Element | null = null;
    if (props.canJoinPublicChannel) {
        browseChannelsMenuItem = (
            <Menu.Item
                id='browseChannelsMenuItem'
                onClick={props.onBrowseChannelClick}
                leadingElement={<GlobeIcon size={18}/>}
                labels={(
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.browseChannelsMenuItem.primaryLabel'
                        defaultMessage='Browse channels'
                    />
                )}
                aria-haspopup='true'
            />
        );
    }

    const createDirectMessageMenuItem = (
        <Menu.Item
            id='openDirectMessageMenuItem'
            onClick={props.onOpenDirectMessageClick}
            leadingElement={<AccountOutlineIcon size={18}/>}
            labels={(
                <FormattedMessage
                    id='sidebarLeft.browserOrCreateChannelMenu.openDirectMessageMenuItem.primaryLabel'
                    defaultMessage='Open a direct message'
                />
            )}
            aria-haspopup='true'
        />
    );

    let createUserGroupMenuItem: JSX.Element | null = null;
    if (props.canCreateCustomGroups) {
        createUserGroupMenuItem = (
            <Menu.Item
                id='createUserGroupMenuItem'
                onClick={props.onCreateNewUserGroupClick}
                leadingElement={<AccountMultiplePlusOutlineIcon size={18}/>}
                labels={(
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.createUserGroupMenuItem.primaryLabel'
                        defaultMessage='Create new user group'
                    />
                )}
                aria-haspopup='true'
            />
        );
    }

    let createNewCategoryMenuItem: JSX.Element | null = null;
    if (!props.unreadFilterEnabled) {
        createNewCategoryMenuItem = (
            <Menu.Item
                id='createCategoryMenuItem'
                onClick={props.onCreateNewCategoryClick}
                leadingElement={<FolderPlusOutlineIcon size={18}/>}
                labels={(
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.createCategoryMenuItem.primaryLabel'
                        defaultMessage='Create new category'
                    />
                )}
                aria-haspopup='true'
            />
        );
    }

    const invitePeopleMenuItem = (
        <Menu.Item
            id='invitePeopleMenuItem'
            onClick={props.onInvitePeopleClick}
            leadingElement={<AccountPlusOutlineIcon size={18}/>}
            labels={(
                <>
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.invitePeopleMenuItem.primaryLabel'
                        defaultMessage='Invite people'
                    />
                    <FormattedMessage
                        id='sidebarLeft.browserOrCreateChannelMenu.invitePeopleMenuItem.secondaryLabel'
                        defaultMessage='Add people to the team'
                    />
                </>
            )}
            trailingElements={showInvitePeopleTutorialTip && <InvitePeopleTour/>}
            aria-haspopup='true'
        />
    );

    let pluggableMenuItems: JSX.Element[] = [];
    let afterCreateChannelMenuItems: JSX.Element[] = [];
    if (pluginMenuItems) {
        const toMenuItem = (item: SidebarBrowseOrAddChannelMenuAction) => {
            const handlePluginItemClick = () => {
                if (item.action) {
                    item.action(currentTeamId);
                }
            };

            return (
                <Menu.Item
                    id={item.id + '_pluginmenuitem'}
                    key={item.id + '_pluginmenuitem'}
                    onClick={handlePluginItemClick}
                    leadingElement={item.icon}
                    labels={<span>{item.text}</span>}
                />
            );
        };
        afterCreateChannelMenuItems = pluginMenuItems.filter((item) => item.placement === 'afterCreateChannel').map(toMenuItem);
        pluggableMenuItems = pluginMenuItems.filter((item) => item.placement !== 'afterCreateChannel').map(toMenuItem);
    }

    return (
        <Menu.Container
            menuButton={{
                id: ELEMENT_ID_FOR_BROWSE_OR_ADD_CHANNEL_MENU_BUTTON,
                'aria-label': formatMessage({
                    id: 'sidebarLeft.browserOrCreateChannelMenuButton.label',
                    defaultMessage: 'Browse or create channels',
                }),
                as: BrowseOrAddChannelMenuTrigger,
                children: <Icon glyph={<PlusIcon/>}/>,
            }}
            menuButtonTooltip={{
                text: formatMessage({id: 'sidebarLeft.browserOrCreateChannelMenuButton.label', defaultMessage: 'Browse or create channels'}),
            }}
            menu={{
                id: 'browserOrAddChannelMenu',
                'aria-labelledby': ELEMENT_ID_FOR_BROWSE_OR_ADD_CHANNEL_MENU_BUTTON,
            }}
        >
            {createNewChannelMenuItem}
            {createRevisionChannelMenuItem}
            {createCanvasChannelMenuItem}
            {afterCreateChannelMenuItems}
            {browseChannelsMenuItem}
            {createDirectMessageMenuItem}
            {createUserGroupMenuItem}
            {pluggableMenuItems}
            {Boolean(createNewCategoryMenuItem) &&
                <Menu.Separator/>
            }
            {createNewCategoryMenuItem}
            <Menu.Separator/>
            {invitePeopleMenuItem}
        </Menu.Container>
    );
}
