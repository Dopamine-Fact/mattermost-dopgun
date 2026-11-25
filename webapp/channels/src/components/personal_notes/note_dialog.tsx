// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {GenericModal} from '@mattermost/components';
import type {PersonalNote, PersonalNoteVisibility} from '@mattermost/types/personal_notes';

import {Client4} from 'mattermost-redux/client';

import {NO_REMINDER, reminderOptions, toLocalDateString, validateNote} from './note_utils';

type Props = {
    teamId: string;
    note: Partial<PersonalNote>;
    readOnly: boolean;
    ownerName: string;
    onClose: () => void;
    onChanged: () => void;
};

const errorMessages: Record<string, string> = {
    'personal_notes.error.title': 'Enter a title of at most 200 characters.',
    'personal_notes.error.message': 'The description can be at most 4000 characters.',
    'personal_notes.error.timeWithoutDate': 'Pick a date to set a time.',
    'personal_notes.error.reminderWithoutDate': 'Pick a date to set a reminder.',
};

const NoteDialog = ({teamId, note: initial, readOnly, ownerName, onClose, onChanged}: Props) => {
    const {formatMessage} = useIntl();
    const [show, setShow] = useState(true);
    const [note, setNote] = useState<Partial<PersonalNote>>(initial);
    const [done, setDone] = useState(Boolean(initial.done_at));
    const [saving, setSaving] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [error, setError] = useState('');
    const isNew = !initial.id;

    const set = (patch: Partial<PersonalNote>) => setNote((n) => ({...n, ...patch}));
    const close = () => setShow(false);

    const save = async () => {
        const problem = validateNote(note);
        if (problem) {
            setError(formatMessage({id: problem, defaultMessage: errorMessages[problem]}));
            return;
        }
        setSaving(true);
        try {
            const fields = {
                title: note.title!.trim(),
                message: note.message ?? '',
                visibility: note.visibility ?? 'private',
                date: note.date ?? '',
                time: note.time ?? '',
                remind_minutes: note.date ? note.remind_minutes ?? NO_REMINDER : NO_REMINDER,
            };
            if (isNew) {
                await Client4.createPersonalNote(teamId, fields);
            } else {
                await Client4.patchPersonalNote(teamId, initial.id!, {...fields, done});
            }
            onChanged();
            close();
        } catch (e) {
            setError((e as Error).message);
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        setSaving(true);
        try {
            await Client4.deletePersonalNote(teamId, initial.id!);
            onChanged();
            close();
        } catch (e) {
            setError((e as Error).message);
            setSaving(false);
        }
    };

    const header = readOnly ? note.title : formatMessage(isNew ? {id: 'personal_notes.dialog.new', defaultMessage: 'New note'} : {id: 'personal_notes.dialog.edit', defaultMessage: 'Edit note'});

    if (readOnly) {
        return (
            <GenericModal
                id='personalNoteDialog'
                className='PersonalNoteDialog'
                modalHeaderText={header}
                show={show}
                onHide={close}
                onExited={onClose}
                compassDesign={true}
            >
                <div className='PersonalNoteDialog__view'>
                    <div className='PersonalNoteDialog__meta'>
                        <strong>{ownerName}</strong>
                        {note.date && <span>{note.time ? `${note.date} ${note.time}` : note.date}</span>}
                        {Boolean(note.done_at) && (
                            <span>
                                <FormattedMessage
                                    id='personal_notes.done'
                                    defaultMessage='Done'
                                />
                            </span>
                        )}
                    </div>
                    {note.message && <p className='PersonalNoteDialog__message'>{note.message}</p>}
                </div>
            </GenericModal>
        );
    }

    const allDay = !note.time;
    const footer = (
        <div className='PersonalNoteDialog__footer'>
            {!isNew && (
                <button
                    type='button'
                    className='btn btn-danger'
                    onClick={remove}
                    disabled={saving}
                >
                    {confirmingDelete ? formatMessage({id: 'personal_notes.dialog.confirmDelete', defaultMessage: 'Delete for good'}) : formatMessage({id: 'personal_notes.dialog.delete', defaultMessage: 'Delete'})}
                </button>
            )}
            <span className='PersonalNoteDialog__spacer'/>
            <button
                type='button'
                className='btn btn-tertiary'
                onClick={close}
            >
                <FormattedMessage
                    id='personal_notes.dialog.cancel'
                    defaultMessage='Cancel'
                />
            </button>
            <button
                type='button'
                className='btn btn-primary'
                onClick={save}
                disabled={saving}
            >
                <FormattedMessage
                    id='personal_notes.dialog.save'
                    defaultMessage='Save'
                />
            </button>
        </div>
    );

    return (
        <GenericModal
            id='personalNoteDialog'
            className='PersonalNoteDialog'
            modalHeaderText={header}
            show={show}
            onHide={close}
            onExited={onClose}
            compassDesign={true}
            footerContent={footer}
        >
            <div className='PersonalNoteDialog__form'>
                <label>
                    <FormattedMessage
                        id='personal_notes.dialog.title'
                        defaultMessage='Title'
                    />
                    <input
                        className='form-control'
                        value={note.title ?? ''}
                        maxLength={200}
                        onChange={(e) => set({title: e.target.value})}
                    />
                </label>
                <label>
                    <FormattedMessage
                        id='personal_notes.dialog.description'
                        defaultMessage='Description'
                    />
                    <textarea
                        className='form-control'
                        rows={3}
                        value={note.message ?? ''}
                        onChange={(e) => set({message: e.target.value})}
                    />
                </label>
                <div className='PersonalNoteDialog__row'>
                    <label className='PersonalNoteDialog__check'>
                        <input
                            type='checkbox'
                            checked={!note.date}
                            onChange={(e) => set(e.target.checked ? {date: '', time: '', remind_minutes: NO_REMINDER} : {date: initial.date || toLocalDateString(new Date())})}
                        />
                        <FormattedMessage
                            id='personal_notes.dialog.noDate'
                            defaultMessage='No date'
                        />
                    </label>
                    {Boolean(note.date) && (
                        <input
                            type='date'
                            className='form-control'
                            aria-label={formatMessage({id: 'personal_notes.dialog.date', defaultMessage: 'Date'})}
                            value={note.date}
                            onChange={(e) => e.target.value && set({date: e.target.value})}
                        />
                    )}
                </div>
                {Boolean(note.date) && (
                    <div className='PersonalNoteDialog__row'>
                        <label className='PersonalNoteDialog__check'>
                            <input
                                type='checkbox'
                                checked={allDay}
                                onChange={(e) => set({time: e.target.checked ? '' : '09:00', remind_minutes: NO_REMINDER})}
                            />
                            <FormattedMessage
                                id='personal_notes.dialog.allDay'
                                defaultMessage='All day'
                            />
                        </label>
                        {!allDay && (
                            <input
                                type='time'
                                className='form-control'
                                aria-label={formatMessage({id: 'personal_notes.dialog.time', defaultMessage: 'Time'})}
                                value={note.time}
                                onChange={(e) => e.target.value && set({time: e.target.value})}
                            />
                        )}
                    </div>
                )}
                {Boolean(note.date) && (
                    <label>
                        <FormattedMessage
                            id='personal_notes.dialog.reminder'
                            defaultMessage='Reminder'
                        />
                        <select
                            className='form-control'
                            value={note.remind_minutes ?? NO_REMINDER}
                            onChange={(e) => set({remind_minutes: Number(e.target.value)})}
                        >
                            {reminderOptions(allDay).map((o) => (
                                <option
                                    key={o.value}
                                    value={o.value}
                                >
                                    {formatMessage({id: o.labelId, defaultMessage: o.defaultMessage})}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <fieldset className='PersonalNoteDialog__row'>
                    <legend>
                        <FormattedMessage
                            id='personal_notes.dialog.visibility'
                            defaultMessage='Who can see it'
                        />
                    </legend>
                    {(['private', 'team'] as PersonalNoteVisibility[]).map((v) => (
                        <label
                            key={v}
                            className='PersonalNoteDialog__check'
                        >
                            <input
                                type='radio'
                                name='personalNoteVisibility'
                                checked={(note.visibility ?? 'private') === v}
                                onChange={() => set({visibility: v})}
                            />
                            {v === 'private' ? formatMessage({id: 'personal_notes.visibility.private', defaultMessage: 'Only me'}) : formatMessage({id: 'personal_notes.visibility.team', defaultMessage: 'Team'})}
                        </label>
                    ))}
                </fieldset>
                {!isNew && (
                    <label className='PersonalNoteDialog__check'>
                        <input
                            type='checkbox'
                            checked={done}
                            onChange={(e) => setDone(e.target.checked)}
                        />
                        <FormattedMessage
                            id='personal_notes.done'
                            defaultMessage='Done'
                        />
                    </label>
                )}
                {error && (
                    <div
                        className='PersonalNoteDialog__error'
                        role='alert'
                    >
                        {error}
                    </div>
                )}
            </div>
        </GenericModal>
    );
};

export default NoteDialog;
