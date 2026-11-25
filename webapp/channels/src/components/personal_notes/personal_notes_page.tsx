// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DatesSetArg, EventClickArg, EventContentArg, EventDropArg} from '@fullcalendar/core';
import allLocales from '@fullcalendar/core/locales-all';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type {DateClickArg} from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import classNames from 'classnames';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {useLocation} from 'react-router-dom';

import {BellOutlineIcon, LockOutlineIcon, PlusIcon} from '@mattermost/compass-icons/components';
import type {PersonalNote} from '@mattermost/types/personal_notes';

import {getMissingProfilesByIds} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId, getUsers} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {getCurrentLocale} from 'selectors/i18n';
import {isUseMilitaryTime} from 'selectors/preferences';

import NoteDialog from './note_dialog';
import {NO_REMINDER, dropToPatch, noteToEvent, toLocalDateString, toLocalTimeString} from './note_utils';
import UndatedList from './undated_list';

import './personal_notes.scss';

type Range = {from: string; to: string};
type DialogState = {note: Partial<PersonalNote>; readOnly: boolean};

const filterKey = (userId: string) => `personal_notes_filter_${userId}`;

function readOnlyMine(userId: string): boolean {
    try {
        return localStorage.getItem(filterKey(userId)) === 'mine';
    } catch {
        return false;
    }
}

function writeOnlyMine(userId: string, onlyMine: boolean) {
    try {
        localStorage.setItem(filterKey(userId), onlyMine ? 'mine' : 'everyone');
    } catch {
        // Storage can be unavailable (private windows); the filter just isn't remembered.
    }
}

const PersonalNotesPage = () => {
    const dispatch = useDispatch();
    const {formatMessage} = useIntl();
    const {search} = useLocation();
    const team = useSelector(getCurrentTeam);
    const currentUserId = useSelector(getCurrentUserId);
    const users = useSelector(getUsers);
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const locale = useSelector(getCurrentLocale);
    const militaryTime = useSelector(isUseMilitaryTime);
    const calendarRef = useRef<FullCalendar>(null);
    const requestSeq = useRef(0);

    const [range, setRange] = useState<Range | null>(null);
    const [onlyMine, setOnlyMine] = useState(() => readOnlyMine(currentUserId));
    const [notes, setNotes] = useState<PersonalNote[]>([]);
    const [undated, setUndated] = useState<PersonalNote[]>([]);
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const [error, setError] = useState('');

    const teamId = team?.id ?? '';

    const refresh = useCallback(async () => {
        if (!teamId || !range) {
            return;
        }
        const seq = ++requestSeq.current;
        try {
            const [dated, withoutDate] = await Promise.all([
                Client4.getPersonalNotes(teamId, {...range, only_mine: onlyMine}),
                Client4.getPersonalNotes(teamId, {undated: true, only_mine: onlyMine}),
            ]);
            if (seq !== requestSeq.current) {
                return;
            }
            setNotes(dated);
            setUndated(withoutDate);
            setError('');
            const owners = [...new Set([...dated, ...withoutDate].map((n) => n.user_id))];
            dispatch(getMissingProfilesByIds(owners));
        } catch (e) {
            if (seq === requestSeq.current) {
                setError((e as Error).message);
            }
        }
    }, [dispatch, teamId, range, onlyMine]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // ?note=<id> comes from a reminder DM: jump to the note and open it.
    const linkedNoteId = new URLSearchParams(search).get('note');
    useEffect(() => {
        if (!teamId || !linkedNoteId) {
            return;
        }
        Client4.getPersonalNote(teamId, linkedNoteId).then((note) => {
            if (note.date) {
                calendarRef.current?.getApi().gotoDate(note.date);
            }
            setDialog({note, readOnly: note.user_id !== currentUserId});
        }).catch((e) => setError((e as Error).message));
    }, [teamId, linkedNoteId, currentUserId]);

    const ownerName = useCallback((userId: string) => {
        const user = users[userId];
        return user ? displayUsername(user, nameDisplay) : '';
    }, [users, nameDisplay]);

    const events = useMemo(() => notes.map((n) => noteToEvent(n, currentUserId, ownerName(n.user_id))), [notes, currentUserId, ownerName]);

    const changeFilter = (mine: boolean) => {
        setOnlyMine(mine);
        writeOnlyMine(currentUserId, mine);
    };

    const openNew = (date: string, time: string) => {
        setDialog({note: {title: '', message: '', date, time, visibility: 'private', remind_minutes: NO_REMINDER}, readOnly: false});
    };

    const openNote = (note: PersonalNote) => setDialog({note, readOnly: note.user_id !== currentUserId});

    const handleDatesSet = (arg: DatesSetArg) => {
        // FullCalendar's end is exclusive.
        setRange({from: toLocalDateString(arg.start), to: toLocalDateString(new Date(arg.end.getTime() - 1))});
    };

    const handleDateClick = (arg: DateClickArg) => openNew(toLocalDateString(arg.date), arg.allDay ? '' : toLocalTimeString(arg.date));

    const handleEventClick = (arg: EventClickArg) => openNote(arg.event.extendedProps.note);

    const handleEventDrop = async (info: EventDropArg) => {
        const note: PersonalNote = info.event.extendedProps.note;
        try {
            await Client4.patchPersonalNote(teamId, note.id, dropToPatch(info.event.start!, info.event.allDay, info.view.type));
            refresh();
        } catch (e) {
            info.revert();
            setError((e as Error).message);
        }
    };

    const toggleDone = async (note: PersonalNote) => {
        try {
            await Client4.patchPersonalNote(teamId, note.id, {done: !note.done_at});
            refresh();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const renderEvent = (arg: EventContentArg) => {
        const note: PersonalNote = arg.event.extendedProps.note;
        const own = note.user_id === currentUserId;
        return (
            <span className='PersonalNote__event'>
                {note.visibility === 'private' && <LockOutlineIcon size={12}/>}
                {arg.timeText && <span className='PersonalNote__time'>{arg.timeText}</span>}
                <span className='PersonalNote__title'>{arg.event.title}</span>
                {!own && <span className='PersonalNote__owner'>{arg.event.extendedProps.ownerName}</span>}
                {note.remind_at > 0 && <BellOutlineIcon size={12}/>}
            </span>
        );
    };

    if (!team?.notes_enabled) {
        return (
            <div className='PersonalNotes app__content'>
                <p className='PersonalNotes__empty'>
                    <FormattedMessage
                        id='personal_notes.disabled'
                        defaultMessage='Personal notes are not enabled for this team.'
                    />
                </p>
            </div>
        );
    }

    return (
        <div className='PersonalNotes app__content'>
            <header className='PersonalNotes__header'>
                <h2>
                    <FormattedMessage
                        id='personal_notes.title'
                        defaultMessage='Calendar'
                    />
                </h2>
                <div
                    className='PersonalNotes__filter'
                    role='group'
                    aria-label={formatMessage({id: 'personal_notes.filter', defaultMessage: 'Show notes from'})}
                >
                    {[false, true].map((mine) => (
                        <button
                            key={String(mine)}
                            type='button'
                            className={classNames('btn btn-sm', mine === onlyMine ? 'btn-primary' : 'btn-tertiary')}
                            aria-pressed={mine === onlyMine}
                            onClick={() => changeFilter(mine)}
                        >
                            {mine ? formatMessage({id: 'personal_notes.filter.mine', defaultMessage: 'Only mine'}) : formatMessage({id: 'personal_notes.filter.everyone', defaultMessage: 'Everyone'})}
                        </button>
                    ))}
                </div>
                <button
                    type='button'
                    className='btn btn-primary btn-sm'
                    onClick={() => openNew(toLocalDateString(new Date()), '')}
                >
                    <PlusIcon size={16}/>
                    <FormattedMessage
                        id='personal_notes.newNote'
                        defaultMessage='Note'
                    />
                </button>
            </header>
            {error && (
                <div
                    className='PersonalNotes__error'
                    role='alert'
                >
                    {error}
                </div>
            )}
            <div className='PersonalNotes__calendar'>
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                    initialView='dayGridMonth'
                    headerToolbar={{left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek'}}
                    locales={allLocales}
                    locale={locale}
                    firstDay={1}
                    height='auto'
                    eventTimeFormat={{hour: '2-digit', minute: '2-digit', hour12: !militaryTime}}
                    slotLabelFormat={{hour: '2-digit', minute: '2-digit', hour12: !militaryTime}}
                    events={events}
                    eventContent={renderEvent}
                    datesSet={handleDatesSet}
                    dateClick={handleDateClick}
                    eventClick={handleEventClick}
                    eventDrop={handleEventDrop}
                    eventDurationEditable={false}
                />
            </div>
            <UndatedList
                notes={undated}
                currentUserId={currentUserId}
                ownerName={ownerName}
                onOpen={openNote}
                onToggleDone={toggleDone}
            />
            {dialog && (
                <NoteDialog
                    teamId={teamId}
                    note={dialog.note}
                    readOnly={dialog.readOnly}
                    ownerName={ownerName(dialog.note.user_id ?? currentUserId)}
                    onClose={() => setDialog(null)}
                    onChanged={refresh}
                />
            )}
        </div>
    );
};

export default PersonalNotesPage;
