// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {ChannelType} from '@mattermost/types/channels';

import SidebarChannel from 'components/sidebar/sidebar_channel/sidebar_channel';

import {renderWithContext, screen, userEvent} from 'tests/react_testing_utils';

jest.mock('components/tours/onboarding_tour', () => ({
    ChannelsAndDirectMessagesTour: () => null,
}));

jest.mock('components/sidebar/sidebar_channel/sidebar_direct_channel', () => () => <div>{'Direct Channel'}</div>);
jest.mock('components/sidebar/sidebar_channel/sidebar_group_channel', () => () => <div>{'Group Channel'}</div>);

describe('components/sidebar/sidebar_channel', () => {
    const baseProps = {
        channel: {
            id: 'channel_id',
            display_name: 'channel_display_name',
            create_at: 0,
            update_at: 0,
            delete_at: 0,
            team_id: '',
            type: 'O' as ChannelType,
            name: '',
            header: '',
            purpose: '',
            last_post_at: 0,
            last_root_post_at: 0,
            creator_id: '',
            scheme_id: '',
            group_constrained: false,
        },
        channelId: 'channel_id',
        isDraggable: false,
        channelIndex: 0,
        currentTeamName: 'team_name',
        unreadMentions: 0,
        isUnread: false,
        setChannelRef: jest.fn(),
        isCategoryCollapsed: false,
        isCurrentChannel: false,
        isAutoSortedCategory: false,
        isCategoryDragged: false,
        isDropDisabled: false,
        draggingState: {},
        multiSelectedChannelIds: [],
        autoSortedCategoryIds: new Set<string>(),
        isChannelSelected: false,
        collapseCategoryWithUnreads: false,
        subChannelIds: [],
    };

    test('should list sub-channels under a parent behind a toggle', async () => {
        localStorage.clear();
        const sub = {...baseProps.channel, id: 'sub_id', name: 'sub', display_name: 'Sub Channel', team_id: 'team_id', parent_id: 'channel_id'};
        renderWithContext(
            <SidebarChannel
                {...baseProps}
                subChannelIds={[sub.id]}
            />,
            {
                entities: {
                    channels: {channels: {[sub.id]: sub}, myMembers: {[sub.id]: {channel_id: sub.id, notify_props: {}}}},
                    teams: {currentTeamId: 'team_id', teams: {team_id: {id: 'team_id', name: 'team_name'}}},
                },
            },
        );

        // Shown under the parent until hidden.
        const toggle = screen.getByRole('button', {name: 'Hide sub-channels'});
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const subRow = screen.getAllByRole('listitem')[1];
        expect(subRow).toHaveClass('SidebarChannel--sub', 'expanded');

        await userEvent.click(toggle);
        expect(screen.getByRole('button', {name: 'Show sub-channels'})).toHaveAttribute('aria-expanded', 'false');
        expect(subRow).toHaveClass('collapsed');
        expect(localStorage.getItem('sidebarSubChannelsOpen:channel_id')).toBe('false');

        await userEvent.click(screen.getByRole('button', {name: 'Show sub-channels'}));
        expect(subRow).toHaveClass('expanded');
        expect(localStorage.getItem('sidebarSubChannelsOpen:channel_id')).toBeNull();
    });

    test('should not be collapsed when there are unread messages', () => {
        const props = {
            ...baseProps,
            isCategoryCollapsed: true,
            isUnread: true,
        };

        renderWithContext(
            <SidebarChannel {...props}/>,
        );

        expect(screen.getByRole('listitem')).toHaveClass('expanded');
    });

    test('should not be collapsed if channel is current channel', () => {
        const props = {
            ...baseProps,
            isCategoryCollapsed: true,
            isCurrentChannel: true,
        };

        renderWithContext(
            <SidebarChannel {...props}/>,
        );

        expect(screen.getByRole('listitem')).toHaveClass('expanded');
    });

    describe('collapse category with unread channels', () => {
        const mutedMentionProps = {
            isUnread: true,
            unreadMentions: 2,
        };

        test('with the setting off, should keep unread and current channels in a collapsed category', () => {
            const {rerender} = renderWithContext(
                <SidebarChannel
                    {...baseProps}
                    isCategoryCollapsed={true}
                    isUnread={true}
                />,
            );
            expect(screen.getByRole('listitem')).toHaveClass('expanded');

            rerender(
                <SidebarChannel
                    {...baseProps}
                    isCategoryCollapsed={true}
                    isCurrentChannel={true}
                />,
            );
            expect(screen.getByRole('listitem')).toHaveClass('expanded');
        });

        test('with the setting on, should hide an unread channel in a collapsed category', () => {
            renderWithContext(
                <SidebarChannel
                    {...baseProps}
                    collapseCategoryWithUnreads={true}
                    isCategoryCollapsed={true}
                    isUnread={true}
                />,
            );

            expect(screen.getByRole('listitem')).toHaveClass('collapsed');
        });

        test('with the setting on, should hide a muted channel with a mention count in a collapsed category', () => {
            renderWithContext(
                <SidebarChannel
                    {...baseProps}
                    {...mutedMentionProps}
                    collapseCategoryWithUnreads={true}
                    isCategoryCollapsed={true}
                />,
            );

            expect(screen.getByRole('listitem')).toHaveClass('collapsed');
        });

        test('with the setting on, should keep the current channel in a collapsed category', () => {
            renderWithContext(
                <SidebarChannel
                    {...baseProps}
                    collapseCategoryWithUnreads={true}
                    isCategoryCollapsed={true}
                    isCurrentChannel={true}
                    isUnread={true}
                />,
            );

            expect(screen.getByRole('listitem')).toHaveClass('expanded');
        });

        test('with the setting on, should keep every channel in an open category', () => {
            const {rerender} = renderWithContext(
                <SidebarChannel
                    {...baseProps}
                    collapseCategoryWithUnreads={true}
                />,
            );
            expect(screen.getByRole('listitem')).toHaveClass('expanded');

            rerender(
                <SidebarChannel
                    {...baseProps}
                    collapseCategoryWithUnreads={true}
                    isUnread={true}
                />,
            );
            expect(screen.getByRole('listitem')).toHaveClass('expanded');

            rerender(
                <SidebarChannel
                    {...baseProps}
                    {...mutedMentionProps}
                    collapseCategoryWithUnreads={true}
                />,
            );
            expect(screen.getByRole('listitem')).toHaveClass('expanded');
        });
    });
});
