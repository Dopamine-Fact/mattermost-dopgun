// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Department} from '@mattermost/types/custom_roles';
import type {DailyReport} from '@mattermost/types/daily_reports';

import {Client4} from 'mattermost-redux/client';
import * as roles from 'mattermost-redux/selectors/entities/roles';

import WebSocketClient from 'client/web_websocket_client';
import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import {daysBefore, MESSAGE_MAX_LENGTH, todayIn} from './common';
import DailyReports from './daily_reports';
import {rowsForRange} from './team_reports';

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
jest.mock('components/pdf_preview', () => ({
    __esModule: true,
    default: ({fileUrl}: {fileUrl: string}) => <div data-url={fileUrl}>{'PDF Preview'}</div>,
}));
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
const pdf = TestHelper.getFileInfoMock({id: 'f3', name: 'plan.pdf', extension: 'pdf', size: 4096, mime_type: 'application/pdf'});

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
                membersInTeam: {team1: {u2: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'u2', roles: 'team_user rk_a'})}},
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

// Status chips only; the status filter lists the same words as options.
const chips = (label: string) => screen.getAllByText(label, {selector: '.DailyReportsPage__chip'});

// Row names only; the member filter lists the same names as options.
const ROW_NAME = '.DailyReportsPage__rowName';

const rowOf = (name: string) => screen.getByText(name, {selector: ROW_NAME}).closest('li') as HTMLElement;

const rowNames = () => screen.getAllByTestId('dailyReportRow').map((row) => row.querySelector('.DailyReportsPage__rowName')?.textContent);

// The per-team departments cache loads once for the whole file.
const departments: Department[] = [{
    id: 'd1',
    team_id: 'team1',
    name: 'Animasyon',
    color: '#123456',
    position: 1,
    is_studio: false,
    create_at: 1,
    update_at: 1,
    delete_at: 0,
    ranks: [{id: 'a', role_name: 'rk_a', team_id: 'team1', department_id: 'd1', display_name: 'Animator', color: '#000', position: 0, permissions: [], member_count: 1, member_ids: [], create_at: 1, update_at: 1, delete_at: 0}],
} as Department];

const lastListener = () => (WebSocketClient.addMessageListener as jest.Mock).mock.calls.at(-1)[0];

describe('DailyReports', () => {
    beforeEach(() => {
        jest.restoreAllMocks();

        // A Monday, so today's missing rows exist and the report fixtures fall on today.
        jest.useFakeTimers({advanceTimers: true, now: new Date('2026-11-16T10:00:00Z')});
        jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue(departments);
        jest.spyOn(Client4, 'getTeamMembers').mockResolvedValue([]);
        localStorage.clear();
        mockReports([]);
        jest.spyOn(Client4, 'getDailyReportAssignees').mockResolvedValue([]);
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['me', 'u2', 'u3', 'u4', 'u5']);
    });

    afterEach(() => {
        jest.useRealTimers();
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
        expect(await screen.findByText('ayse', {selector: ROW_NAME})).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('mehmet', {selector: ROW_NAME})).not.toBeInTheDocument());
        expect(chips('Missing')).toHaveLength(2); // me and ayse
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
        expect(chips('Missing')).toHaveLength(2); // me and mehmet have no report
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
        expect(await screen.findByText('Auto-approved', {selector: '.DailyReportsPage__chip'})).toBeInTheDocument();
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
        expect(screen.getByText('leaver', {selector: ROW_NAME})).toBeInTheDocument();
        expect(screen.queryByText('bot')).not.toBeInTheDocument();
        expect(chips('Missing')).toHaveLength(3); // me, ayse and mehmet
    });

    test('Reporters modal saves the checked members and limits the rows', async () => {
        const save = jest.spyOn(Client4, 'setDailyReportAssignees').mockResolvedValue(['u2']);
        renderPage(true);

        await openTeamTab();
        expect(await screen.findByText('mehmet', {selector: ROW_NAME})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Reporters'}));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('checkbox', {name: 'ayse'}));
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Save'}));
        });

        expect(save).toHaveBeenCalledWith('team1', ['u2']);
        await waitFor(() => expect(screen.queryByText('mehmet', {selector: ROW_NAME})).not.toBeInTheDocument());
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

describe('DailyReports team tab', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.useFakeTimers({advanceTimers: true, now: new Date('2026-11-16T10:00:00Z')});
        localStorage.clear();
        mockReports([]);
        jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue(departments);
        jest.spyOn(Client4, 'getTeamMembers').mockResolvedValue([]);
        jest.spyOn(Client4, 'getDailyReportAssignees').mockResolvedValue([]);
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['me', 'u2', 'u3', 'u4', 'u5']);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('team: search matches name and message text', async () => {
        mockReports([], [report({message: 'Wrote the parser'}), report({id: 'r2', user_id: 'u3', message: 'Fixed lights'})]);
        renderPage(true);
        await openTeamTab();
        expect(await screen.findByText('Fixed lights')).toBeInTheDocument();

        const search = screen.getByPlaceholderText('Search people or report text…');
        fireEvent.change(search, {target: {value: 'PARSER'}});
        expect(screen.getByText('Wrote the parser')).toBeInTheDocument();
        expect(screen.queryByText('Fixed lights')).not.toBeInTheDocument();

        fireEvent.change(search, {target: {value: 'mehm'}});
        expect(screen.getByText('Fixed lights')).toBeInTheDocument();
        expect(screen.queryByText('Wrote the parser')).not.toBeInTheDocument();
    });

    test('team: status filter Eksik shows only missing rows', async () => {
        mockReports([], [report({message: 'Wrote the parser'})]);
        renderPage(true);
        await openTeamTab();
        expect(await screen.findByText('Wrote the parser')).toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', {name: 'Status'}), {target: {value: 'missing'}});
        expect(screen.queryByText('Wrote the parser')).not.toBeInTheDocument();
        expect(rowNames()).toEqual(['me', 'mehmet']);
        expect(chips('Missing')).toHaveLength(2);
    });

    test('team: department filter keeps members of that department', async () => {
        renderPage(true);
        await openTeamTab();
        await screen.findByRole('option', {name: 'Animasyon'});

        fireEvent.change(screen.getByRole('combobox', {name: 'Team / member'}), {target: {value: 'dept:d1'}});
        expect(rowNames()).toEqual(['ayse']);

        fireEvent.change(screen.getByRole('combobox', {name: 'Team / member'}), {target: {value: 'user:u3'}});
        expect(rowNames()).toEqual(['mehmet']);
    });

    test('team: sort by name A→Z', async () => {
        mockReports([], [report({create_at: 5}), report({id: 'r2', user_id: 'u3', message: 'Fixed lights', create_at: 9})]);
        renderPage(true);
        await openTeamTab();
        await screen.findByText('Fixed lights');
        expect(rowNames()).toEqual(['mehmet', 'ayse', 'me']); // newest sent first, missing last

        fireEvent.change(screen.getByRole('combobox', {name: 'Sort'}), {target: {value: 'name'}});
        expect(rowNames()).toEqual(['ayse', 'me', 'mehmet']);
    });

    test('team: To is clamped to 31 days after From', async () => {
        const list = mockReports([], []);
        renderPage(true);
        await openTeamTab();

        fireEvent.change(await screen.findByLabelText('From'), {target: {value: '2026-10-01'}});
        expect(screen.getByLabelText('To')).toHaveValue('2026-10-31');
        await waitFor(() => expect(list).toHaveBeenLastCalledWith('team1', '2026-10-01', '2026-10-31'));
        expect(screen.getByText('Download CSV').closest('a')).toHaveAttribute('href', expect.stringContaining('from=2026-10-01'));
    });

    test('team: day arrows move the range one day, not past today', async () => {
        const list = mockReports([], []);
        renderPage(true);
        await openTeamTab();
        const next = await screen.findByRole('button', {name: 'Next day'});
        expect(next).toBeDisabled();

        fireEvent.click(screen.getByRole('button', {name: 'Previous day'}));
        expect(screen.getByLabelText('From')).toHaveValue('2026-11-15');
        expect(screen.getByLabelText('To')).toHaveValue('2026-11-15');
        await waitFor(() => expect(list).toHaveBeenLastCalledWith('team1', '2026-11-15', '2026-11-15'));

        fireEvent.click(next);
        expect(screen.getByLabelText('From')).toHaveValue('2026-11-16');
        expect(next).toBeDisabled();
    });

    test('team: Onayla on a missing row asks, then excuses that user and date', async () => {
        const excuse = jest.spyOn(Client4, 'excuseDailyReport').mockResolvedValue(report({user_id: 'u3', status: 'excused'}));
        renderPage(true);
        await openTeamTab();
        await screen.findByText('mehmet', {selector: ROW_NAME});

        fireEvent.click(within(rowOf('mehmet')).getByRole('button', {name: 'Excuse'}));
        const dialog = await screen.findByRole('dialog');
        expect(excuse).not.toHaveBeenCalled();
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Excuse'}));
        });

        expect(excuse).toHaveBeenCalledWith('team1', 'u3', '2026-11-16');
    });

    test('team: an excuse refused because the day was sent meanwhile refreshes the list', async () => {
        jest.spyOn(Client4, 'excuseDailyReport').mockRejectedValue({status_code: 409, message: 'Already sent'});
        const list = mockReports([], []);
        renderPage(true);
        await openTeamTab();
        await screen.findByText('mehmet', {selector: ROW_NAME});
        const calls = list.mock.calls.length;

        fireEvent.click(within(rowOf('mehmet')).getByRole('button', {name: 'Excuse'}));
        const dialog = await screen.findByRole('dialog');
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Excuse'}));
        });

        expect(await screen.findByText('Already sent')).toBeInTheDocument();
        await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(calls));
    });

    test('team: no Reddet on missing or excused rows', async () => {
        mockReports([], [report({status: 'excused', message: ''})]);
        renderPage(true);
        await openTeamTab();
        expect(await screen.findByText('Excused', {selector: '.DailyReportsPage__chip'})).toBeInTheDocument();

        expect(screen.queryByRole('button', {name: 'Reject'})).not.toBeInTheDocument();
        expect(within(rowOf('ayse')).getAllByRole('button').map((b) => b.textContent)).toEqual(['View']);
        expect(within(rowOf('mehmet')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Excuse']);
    });

    test('team: Görüntüle opens the detail with the gallery', async () => {
        mockReports([], [report({files: [png, mp4]})]);
        const approve = jest.spyOn(Client4, 'approveDailyReport').mockResolvedValue(report({status: 'approved'}));
        renderPage(true);
        await openTeamTab();
        expect(await screen.findByText('2 media')).toBeInTheDocument();

        fireEvent.click(within(rowOf('ayse')).getByRole('button', {name: 'View'}));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('img', {name: 'a.png'})).toBeInTheDocument();
        expect(dialog.querySelector('video')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', {name: 'Approve'}));
        });
        expect(approve).toHaveBeenCalledWith('r1', 1);
    });

    test('team: a PDF opens inside the detail and still downloads', async () => {
        mockReports([], [report({files: [pdf]})]);
        renderPage(true);
        await openTeamTab();
        fireEvent.click(await within(rowOf('ayse')).findByRole('button', {name: 'View'}));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).queryByText('PDF Preview')).not.toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', {name: 'plan.pdf'}));
        const viewer = await within(dialog).findByText('PDF Preview');
        expect(viewer).toHaveAttribute('data-url', expect.stringContaining('/daily_reports/r1/files/f3'));
        expect(within(dialog).getByRole('link', {name: 'Download plan.pdf'})).toHaveAttribute('href', expect.stringContaining('/daily_reports/r1/files/f3'));

        fireEvent.click(within(dialog).getByRole('button', {name: 'plan.pdf'}));
        expect(within(dialog).queryByText('PDF Preview')).not.toBeInTheDocument();
    });
});

describe('rowsForRange', () => {
    test('rowsForRange: Mon–Sun range gives missing rows only for Mon–Fri', () => {
        const saturday = report({date: '2026-11-21'});
        const rows = rowsForRange('2026-11-16', '2026-11-22', [ayse], [saturday]);

        expect(rows.filter((r) => !r.report).map((r) => r.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
        expect(rows.filter((r) => r.report).map((r) => [r.user.id, r.date])).toEqual([['u2', '2026-11-21']]);
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
