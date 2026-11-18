// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DropResult} from '@hello-pangea/dnd';
import React from 'react';

import type {CustomRole} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';

import WebSocketClient from 'client/web_websocket_client';
import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';

import CustomRoles from './custom_roles';

jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));

let mockOnDragEnd: (result: DropResult) => void = () => {};
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({onDragEnd, children}: {onDragEnd: (r: DropResult) => void; children: React.ReactNode}) => {
        mockOnDragEnd = onDragEnd;
        return children;
    },
    Droppable: ({children}: {children: (p: unknown) => React.ReactNode}) => children({innerRef: () => {}, droppableProps: {}, placeholder: null}),
    Draggable: ({children}: {children: (p: unknown, s: unknown) => React.ReactNode}) => children({innerRef: () => {}, draggableProps: {}, dragHandleProps: {}}, {isDragging: false}),
}));

const role = (id: string, name: string, position: number, department = ''): CustomRole => ({
    id,
    role_name: 'cr_' + id,
    display_name: name,
    color: '#1e90ff',
    position,
    department,
    permissions: [],
    create_at: 1,
    update_at: 1,
    delete_at: 0,
});

const producer = role('p', 'Producer', 0);
const lead = role('l', 'Lead Animator', 1, 'Animation');
const anim = role('a', 'Animator', 2, 'Animation');
const counts: Record<string, number> = {cr_p: 1, cr_l: 2, cr_a: 3};

const rows = () => screen.getAllByTestId('customRoleRow');

describe('CustomRoles', () => {
    beforeEach(() => {
        jest.restoreAllMocks();

        // Out of order on purpose: the page sorts by position.
        jest.spyOn(Client4, 'getCustomRoles').mockResolvedValue([anim, producer, lead]);
        jest.spyOn(Client4, 'getFilteredUsersStats').mockImplementation(({roles}) => Promise.resolve({total_users_count: counts[roles![0]]}));
    });

    test('lists roles in rank order with color, department and member count', async () => {
        renderWithContext(<CustomRoles/>);
        await waitFor(() => expect(rows()).toHaveLength(3));

        expect(rows().map((r) => within(r).getByTestId('customRoleName').textContent)).toEqual(['Producer', 'Lead Animator', 'Animator']);
        expect(within(rows()[1]).getByTestId('customRoleColor')).toHaveStyle({backgroundColor: '#1e90ff'});
        expect(within(rows()[1]).getByText('Animation')).toBeInTheDocument();
        await waitFor(() => expect(within(rows()[2]).getByText('3 members')).toBeInTheDocument());
        expect(within(rows()[0]).getByText('1 member')).toBeInTheDocument();
    });

    test('dragging a row saves the new order', async () => {
        const reorder = jest.spyOn(Client4, 'reorderCustomRoles').mockResolvedValue([{...anim, position: 0}, {...producer, position: 1}, {...lead, position: 2}]);
        renderWithContext(<CustomRoles/>);
        await waitFor(() => expect(rows()).toHaveLength(3));

        await act(async () => mockOnDragEnd({source: {index: 2, droppableId: 'x'}, destination: {index: 0, droppableId: 'x'}} as DropResult));

        expect(reorder).toHaveBeenCalledWith(['a', 'p', 'l']);
        expect(rows().map((r) => within(r).getByTestId('customRoleName').textContent)).toEqual(['Animator', 'Producer', 'Lead Animator']);
    });

    test('reloads when another admin changes the roles', async () => {
        renderWithContext(<CustomRoles/>);
        await waitFor(() => expect(rows()).toHaveLength(3));
        jest.spyOn(Client4, 'getCustomRoles').mockResolvedValue([producer]);

        const listener = (WebSocketClient.addMessageListener as jest.Mock).mock.calls.at(-1)[0];
        await act(async () => listener({event: 'custom_roles_changed', data: {}}));

        await waitFor(() => expect(rows()).toHaveLength(1));
    });

    test('the role form validates and sends only the checked permissions', async () => {
        const create = jest.spyOn(Client4, 'createCustomRole').mockResolvedValue(role('n', 'Intern', 3));
        renderWithContext(<CustomRoles/>);
        await waitFor(() => expect(rows()).toHaveLength(3));

        fireEvent.click(screen.getByRole('button', {name: 'Add role'}));
        const modal = await screen.findByRole('dialog');
        expect(within(modal).getAllByRole('checkbox')).toHaveLength(4);

        fireEvent.click(within(modal).getByRole('button', {name: 'Save'}));
        expect(within(modal).getByText('Enter a name.')).toBeInTheDocument();
        expect(create).not.toHaveBeenCalled();

        fireEvent.change(within(modal).getByLabelText('Name'), {target: {value: ' Intern '}});
        fireEvent.change(within(modal).getByLabelText('Color'), {target: {value: 'blue'}});
        fireEvent.click(within(modal).getByRole('button', {name: 'Save'}));
        expect(within(modal).getByText('Use a hex color like #1e90ff.')).toBeInTheDocument();
        expect(create).not.toHaveBeenCalled();

        fireEvent.change(within(modal).getByLabelText('Color'), {target: {value: '#AA00CC'}});
        fireEvent.change(within(modal).getByLabelText('Department'), {target: {value: 'Animation'}});
        fireEvent.click(within(modal).getByRole('checkbox', {name: /Manage daily reports/}));
        fireEvent.click(within(modal).getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(create).toHaveBeenCalledWith({
            display_name: 'Intern',
            color: '#aa00cc',
            department: 'Animation',
            permissions: ['manage_daily_reports'],
        }));
    });

    test('delete asks for confirmation naming the member count', async () => {
        const del = jest.spyOn(Client4, 'deleteCustomRole').mockResolvedValue({status: 'OK'});
        renderWithContext(<CustomRoles/>);
        await waitFor(() => expect(within(rows()[2]).getByText('3 members')).toBeInTheDocument());

        fireEvent.click(within(rows()[2]).getByRole('button', {name: 'Delete Animator'}));
        const modal = await screen.findByRole('dialog');
        expect(modal).toHaveTextContent('3 members will lose this role.');
        expect(del).not.toHaveBeenCalled();

        fireEvent.click(within(modal).getByRole('button', {name: 'Delete'}));
        await waitFor(() => expect(del).toHaveBeenCalledWith('a'));
    });
});
