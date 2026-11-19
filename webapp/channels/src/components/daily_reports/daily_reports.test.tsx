// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {DailyReport} from '@mattermost/types/daily_reports';

import {Client4} from 'mattermost-redux/client';
import * as roles from 'mattermost-redux/selectors/entities/roles';

import WebSocketClient from 'client/web_websocket_client';
import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import {daysBefore, MESSAGE_MAX_LENGTH, todayIn} from './common';
import DailyReports from './daily_reports';

jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInTeam: jest.fn(() => () => Promise.resolve({data: []})),
    getMissingProfilesByIds: jest.fn(() => () => Promise.resolve({data: []})),
}));
jest.mock('mattermost-redux/selectors/entities/roles', () => ({
    ...jest.requireActual('mattermost-redux/selectors/entities/roles'),
    haveITeamPermission: jest.fn(() => false),
}));
jest.mock('components/markdown', () => ({message}: {message: string}) => <p>{message}</p>);
jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));

const me = TestHelper.getUserMock({id: 'me', username: 'me'});
const ayse = TestHelper.getUserMock({id: 'u2', username: 'ayse'});
const mehmet = TestHelper.getUserMock({id: 'u3', username: 'mehmet'});

const report = (extra: Partial<DailyReport>): DailyReport => ({
    id: 'r1',
    team_id: 'team1',
    user_id: 'u2',
    date: '2026-11-16',
    message: 'Wrote the parser',
    tasks: [{id: 't1', title: 'Parser task', section_name: 'Backend'}],
    status: 'pending',
    auto_approved: false,
    approved_by: '',
    approved_at: 0,
    edited: false,
    previous_message: '',
    rejected_by: '',
    rejected_at: 0,
    reject_reason: '',
    create_at: 1,
    update_at: 1,
    ...extra,
});

const png = TestHelper.getFileInfoMock({id: 'f1', name: 'a.png', extension: 'png', size: 1258291, mime_type: 'image/png', has_preview_image: true});
const mp4 = TestHelper.getFileInfoMock({id: 'f2', name: 'clip.mp4', extension: 'mp4', size: 2048, mime_type: 'video/mp4'});

const bot = TestHelper.getUserMock({id: 'u4', username: 'bot', is_bot: true});
const exMember = TestHelper.getUserMock({id: 'u5', username: 'leaver'});

const renderPage = (canApprove: boolean) => {
    (roles.haveITeamPermission as jest.Mock).mockReturnValue(canApprove);
    return renderWithContext(<DailyReports/>, {
        entities: {
            general: {config: {}},
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', daily_reports_enabled: true})},
            },
            users: {
                currentUserId: 'me',
                profiles: {me, u2: ayse, u3: mehmet, u4: bot, u5: exMember},
                profilesInTeam: {team1: new Set(['me', 'u2', 'u3', 'u4'])},
            },
        },
    });
};

// mockReports answers the today call (no dates) and the date-range calls separately.
const mockReports = (today: DailyReport[], ranged: DailyReport[] = []) =>
    jest.spyOn(Client4, 'getDailyReports').mockImplementation((_teamId, from) => Promise.resolve(from ? ranged : today));

const editor = () => screen.findByTestId('dailyReportEditor_today');

const openTeamTab = async () => {
    fireEvent.click(await screen.findByRole('tab', {name: 'Team reports'}));
};

const lastListener = () => (WebSocketClient.addMessageListener as jest.Mock).mock.calls.at(-1)[0];

describe('DailyReports', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
        mockReports([]);
        jest.spyOn(Client4, 'getDailyReportAssignees').mockResolvedValue([]);
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['me', 'u2', 'u3', 'u4', 'u5']);
    });

    test('a lead cannot review their own report', async () => {
        mockReports([], [report({id: 'mine', user_id: 'me', message: 'My own day'}), report({message: 'Ayse day'})]);
        renderPage(true);
        (roles.haveITeamPermission as jest.Mock).mockImplementation((_state, _team, perm) => perm !== 'manage_team');

        await openTeamTab();
        expect(await screen.findByText('My own day')).toBeInTheDocument();
        expect(screen.getAllByRole('button', {name: 'Approve'})).toHaveLength(1); // ayse's only
    });

    test('the roster lists only members the viewer outranks', async () => {
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['me', 'u2']);
        renderPage(true);

        await openTeamTab();
        expect(await screen.findByText('ayse')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('mehmet')).not.toBeInTheDocument());
        expect(screen.getAllByText('Missing')).toHaveLength(2); // me and ayse
        expect(Client4.getActionableUserIds).toHaveBeenCalledWith('team1', 'manage_daily_reports');
    });

    test('submits on Ctrl+Enter and shows the rendered report', async () => {
        const submit = jest.spyOn(Client4, 'submitDailyReport').mockResolvedValue(report({user_id: 'me', message: 'Did things'}));
        renderPage(false);

        const box = await editor();
        fireEvent.input(box, {target: {value: 'Did things'}});
        await act(async () => {
            fireEvent.keyDown(box, {key: 'Enter', ctrlKey: true});
        });

        expect(submit).toHaveBeenCalledWith('team1', 'Did things');
        expect(await screen.findByText('Did things')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Edit'})).toBeInTheDocument();
    });

    test('Ctrl+Enter does not send a report over the length limit', async () => {
        const submit = jest.spyOn(Client4, 'submitDailyReport').mockResolvedValue(report({user_id: 'me'}));
        renderPage(false);

        const box = await editor();
        fireEvent.input(box, {target: {value: 'x'.repeat(MESSAGE_MAX_LENGTH + 1)}});
        await act(async () => {
            fireEvent.keyDown(box, {key: 'Enter', ctrlKey: true});
        });

        expect(submit).not.toHaveBeenCalled();
    });

    test('restores an unsent draft for today', async () => {
        localStorage.setItem(`dailyReportDraft:team1:${todayIn(undefined)}`, JSON.stringify({text: 'half written', base: ''}));
        renderPage(false);
        expect(await editor()).toHaveValue('half written');
    });

    test('restores an edit draft while the report is unchanged', async () => {
        mockReports([report({user_id: 'me', message: 'v1'})]);
        localStorage.setItem(`dailyReportDraft:team1:${todayIn(undefined)}`, JSON.stringify({text: 'v1 plus more', base: 'v1'}));
        renderPage(false);
        expect(await editor()).toHaveValue('v1 plus more');
    });

    test('drops a leftover draft when the report changed elsewhere', async () => {
        mockReports([report({user_id: 'me', message: 'v2 from another tab'})]);
        localStorage.setItem(`dailyReportDraft:team1:${todayIn(undefined)}`, JSON.stringify({text: 'stale', base: 'v1'}));
        renderPage(false);

        expect(await screen.findByText('v2 from another tab')).toBeInTheDocument();
        expect(screen.queryByTestId('dailyReportEditor_today')).not.toBeInTheDocument();
        expect(localStorage.getItem(`dailyReportDraft:team1:${todayIn(undefined)}`)).toBeNull();
    });

    test('a resubmitted report still shows why it was sent back', async () => {
        mockReports([report({user_id: 'me', status: 'pending', reject_reason: 'Add the ticket links', rejected_by: 'u2'})]);
        renderPage(false);

        expect(await screen.findByText('Previously sent back: Add the ticket links')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    test('My report asks only for the current user', async () => {
        const list = mockReports([]);
        renderPage(true);

        await editor();
        await waitFor(() => expect(list).toHaveBeenCalledWith('team1', undefined, undefined, 'me'));
    });

    test('My report follows the server report when it changes', async () => {
        const list = mockReports([report({user_id: 'me', message: 'v1'})]);
        renderPage(false);
        expect(await screen.findByText('v1')).toBeInTheDocument();

        list.mockImplementation((_teamId, from) => Promise.resolve(from ? [] : [report({user_id: 'me', message: 'v2', update_at: 2})]));
        await act(async () => {
            lastListener()({event: 'daily_report_updated'});
        });

        expect(await screen.findByText('v2')).toBeInTheDocument();
    });

    test('a rejected report shows the reason banner', async () => {
        mockReports([report({user_id: 'me', status: 'rejected', reject_reason: 'Add the ticket links', rejected_by: 'u2'})]);
        renderPage(false);

        const banner = await screen.findByRole('status');
        expect(banner).toHaveTextContent('Add the ticket links');
        expect(banner).toHaveTextContent('ayse');
    });

    test('recent reports: a rejected report\'s detail offers Edit and saves by id', async () => {
        mockReports([], [
            report({id: 'old', user_id: 'me', date: '2000-01-01', status: 'rejected', reject_reason: 'Too short', message: 'Short'}),
            report({id: 'ok', user_id: 'me', date: '2000-01-02', message: 'Fine day'}),
        ]);
        const update = jest.spyOn(Client4, 'updateDailyReport').mockResolvedValue(report({id: 'old', user_id: 'me', date: '2000-01-01', message: 'Longer'}));
        renderPage(false);

        expect(await screen.findByText('Recent reports')).toBeInTheDocument();
        expect(screen.queryByText('Needs fixing')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: /Short/}));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Too short/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Edit'}));
        const box = await within(dialog).findByTestId('dailyReportEditor_old');
        fireEvent.input(box, {target: {value: 'Longer'}});
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Save'}));
        });

        expect(update).toHaveBeenCalledWith('old', 'Longer');
    });

    test('recent reports: lists the last 30 days with attachment count and opens the detail modal', async () => {
        const list = mockReports([], [
            report({id: 'a', user_id: 'me', date: '2000-01-01', message: 'Older day'}),
            report({id: 'b', user_id: 'me', date: '2000-01-03', message: 'Newer day', files: [png, mp4]}),
        ]);
        renderPage(false);

        const newer = await screen.findByRole('button', {name: /Newer day/});
        const older = screen.getByRole('button', {name: /Older day/});
        expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(newer).toHaveTextContent('2 attachments');
        expect(older).not.toHaveTextContent('attachment');
        expect(list).toHaveBeenCalledWith('team1', daysBefore(todayIn(undefined), 30), todayIn(undefined), 'me');

        fireEvent.click(newer);
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Newer day')).toBeInTheDocument();
        expect(within(dialog).getByRole('img', {name: 'a.png'})).toBeInTheDocument();
        expect(dialog.querySelector('video[controls]')).toHaveAttribute('src', Client4.getDailyReportFileUrl('b', 'f2'));
    });

    test('media: uploads a dropped file and lists it with size and type', async () => {
        const upload = jest.spyOn(Client4, 'uploadMyDailyReportFile').mockResolvedValue(png);
        renderPage(false);

        await editor();
        await act(async () => {
            fireEvent.drop(screen.getByTestId('dailyReportDropZone'), {dataTransfer: {files: [new File(['x'], 'a.png', {type: 'image/png'})]}});
        });

        expect(upload).toHaveBeenCalledWith('team1', expect.any(File), expect.any(Function));
        expect(await screen.findByText('a.png')).toBeInTheDocument();
        expect(screen.getByText(/1\.2 ?MB · PNG/)).toBeInTheDocument();
    });

    test('media: refuses an .exe before uploading', async () => {
        const upload = jest.spyOn(Client4, 'uploadMyDailyReportFile').mockResolvedValue(png);
        renderPage(false);

        await editor();
        await act(async () => {
            fireEvent.drop(screen.getByTestId('dailyReportDropZone'), {dataTransfer: {files: [new File(['x'], 'run.exe')]}});
        });

        expect(upload).not.toHaveBeenCalled();
        expect(screen.getByText('run.exe')).toBeInTheDocument();
        expect(screen.getByText('This file type can\'t be attached.')).toBeInTheDocument();
    });

    test('media: removes a file', async () => {
        mockReports([report({id: 'd1', user_id: 'me', status: 'draft', message: '', files: [png]})]);
        const remove = jest.spyOn(Client4, 'deleteDailyReportFile').mockResolvedValue({status: 'OK'});
        renderPage(false);

        await editor();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'Remove a.png'}));
        });

        expect(remove).toHaveBeenCalledWith('d1', 'f1');
    });

    test('media: an 11th file is refused in the browser', async () => {
        const ten = Array.from({length: 10}, (_, i) => ({...png, id: `f${i}`, name: `s${i}.png`}));
        mockReports([report({id: 'd1', user_id: 'me', status: 'draft', message: '', files: ten})]);
        const upload = jest.spyOn(Client4, 'uploadMyDailyReportFile').mockResolvedValue(png);
        renderPage(false);

        await editor();
        await act(async () => {
            fireEvent.drop(screen.getByTestId('dailyReportDropZone'), {dataTransfer: {files: [new File(['x'], 'eleven.png', {type: 'image/png'})]}});
        });

        expect(upload).not.toHaveBeenCalled();
        expect(screen.getByText('A report can have at most 10 attachments.')).toBeInTheDocument();
    });

    test('today card: sends with only attachments and an empty message', async () => {
        mockReports([report({id: 'd1', user_id: 'me', status: 'draft', message: '', files: [png]})]);
        const submit = jest.spyOn(Client4, 'submitDailyReport').mockResolvedValue(report({id: 'd1', user_id: 'me', message: '', files: [png]}));
        renderPage(false);

        expect(await screen.findByText('Draft')).toBeInTheDocument();
        await editor();
        const send = screen.getByRole('button', {name: 'Send report'});
        expect(send).toBeEnabled();
        await act(async () => {
            fireEvent.click(send);
        });

        expect(submit).toHaveBeenCalledWith('team1', '');
    });

    test('today card: pasting an image into the editor attaches it', async () => {
        const upload = jest.spyOn(Client4, 'uploadMyDailyReportFile').mockResolvedValue(png);
        renderPage(false);

        const box = await editor();
        await act(async () => {
            fireEvent.paste(box, {clipboardData: {files: [new File(['x'], 'shot.png', {type: 'image/png'})]}});
        });

        expect(upload).toHaveBeenCalledWith('team1', expect.any(File), expect.any(Function));
    });

    test('the author sees their pending report as Sent', async () => {
        mockReports([report({user_id: 'me', status: 'pending'})]);
        renderPage(false);

        expect(await screen.findByText('Sent')).toBeInTheDocument();
    });

    test('an unlisted user sees that no report is expected', async () => {
        jest.spyOn(Client4, 'getDailyReportAssignees').mockResolvedValue(['u2']);
        renderPage(false);

        expect(await screen.findByText('No report is expected from you in this team.')).toBeInTheDocument();
        expect(screen.queryByTestId('dailyReportEditor_today')).not.toBeInTheDocument();
    });

    test('hides the Team reports tab without permission', async () => {
        renderPage(false);
        await screen.findByRole('tab', {name: 'My report'});
        expect(screen.queryByRole('tab', {name: 'Team reports'})).not.toBeInTheDocument();
    });

    test('approves a pending row with the version it shows', async () => {
        mockReports([], [report({update_at: 7})]);
        const approve = jest.spyOn(Client4, 'approveDailyReport').mockResolvedValue(report({status: 'approved'}));
        renderPage(true);

        await openTeamTab();
        expect(await screen.findByText('Wrote the parser')).toBeInTheDocument();
        expect(screen.getAllByText('Missing')).toHaveLength(2); // me and mehmet have no report
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'Approve'}));
        });

        expect(approve).toHaveBeenCalledWith('r1', 7);
    });

    test('a resubmitted row shows the earlier reason to the reviewer', async () => {
        mockReports([], [report({status: 'pending', reject_reason: 'Too vague', rejected_by: 'me'})]);
        renderPage(true);

        await openTeamTab();
        expect(await screen.findByText('Previously sent back: Too vague')).toBeInTheDocument();
    });

    test('an edited row reveals the previous text on click', async () => {
        mockReports([], [report({edited: true, previous_message: 'First try'})]);
        renderPage(true);

        await openTeamTab();
        const tag = await screen.findByRole('button', {name: 'Edited'});
        expect(screen.queryByText('First try')).not.toBeInTheDocument();
        fireEvent.click(tag);
        expect(screen.getByText('First try')).toBeInTheDocument();
    });

    test('Reject needs a reason, and is offered on auto-approved rows', async () => {
        mockReports([], [report({status: 'approved', auto_approved: true, update_at: 3})]);
        const reject = jest.spyOn(Client4, 'rejectDailyReport').mockResolvedValue(report({status: 'rejected'}));
        renderPage(true);

        await openTeamTab();
        expect(await screen.findByText('Auto-approved')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Approve'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Reject'}));

        const dialog = await screen.findByRole('dialog');
        const confirm = within(dialog).getByRole('button', {name: 'Reject'});
        expect(confirm).toBeDisabled();
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Reason'}), {target: {value: 'Missing links'}});
        expect(confirm).toBeEnabled();
        await act(async () => {
            fireEvent.click(confirm);
        });

        expect(reject).toHaveBeenCalledWith('r1', 'Missing links', 3);
    });

    test('lists report authors who left the team but not bots without a report', async () => {
        mockReports([], [report({user_id: 'u5', message: 'Handover notes'})]);
        renderPage(true);

        await openTeamTab();
        expect(await screen.findByText('Handover notes')).toBeInTheDocument();
        expect(screen.getByText('leaver')).toBeInTheDocument();
        expect(screen.queryByText('bot')).not.toBeInTheDocument();
        expect(screen.getAllByText('Missing')).toHaveLength(3); // me, ayse and mehmet
    });

    test('Reporters modal saves the checked members and limits the rows', async () => {
        const save = jest.spyOn(Client4, 'setDailyReportAssignees').mockResolvedValue(['u2']);
        renderPage(true);

        await openTeamTab();
        expect(await screen.findByText('mehmet')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Reporters'}));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('checkbox', {name: 'ayse'}));
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Save'}));
        });

        expect(save).toHaveBeenCalledWith('team1', ['u2']);
        await waitFor(() => expect(screen.queryByText('mehmet')).not.toBeInTheDocument());
    });

    test('disables the CSV download when the range is reversed', async () => {
        renderPage(false);
        const link = await screen.findByText('Download CSV');
        expect(link.closest('a')).toHaveAttribute('href');

        const [from] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/);
        fireEvent.change(from, {target: {value: '2999-01-01'}});

        expect(link.closest('a')).not.toHaveAttribute('href');
        expect(link.closest('a')).toHaveAttribute('aria-disabled', 'true');
    });

    test('clears the error after a successful refresh', async () => {
        const list = jest.spyOn(Client4, 'getDailyReports').mockRejectedValue(new Error('boom'));
        renderPage(false);
        expect(await screen.findByRole('alert')).toHaveTextContent('boom');

        list.mockResolvedValue([]);
        await act(async () => {
            lastListener()({event: 'daily_report_updated'});
        });

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
});

describe('todayIn', () => {
    const instant = new Date('2026-11-16T23:30:00Z');

    test('uses the team timezone for the date boundary', () => {
        expect(todayIn('Europe/Istanbul', instant)).toBe('2026-11-17');
        expect(todayIn('America/New_York', instant)).toBe('2026-11-16');
    });

    test('falls back to the browser timezone when empty or invalid', () => {
        const local = todayIn(undefined, instant);
        expect(todayIn('', instant)).toBe(local);
        expect(todayIn('Not/AZone', instant)).toBe(local);
    });
});
