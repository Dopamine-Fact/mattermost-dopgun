// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {forwardRef, useImperativeHandle, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import type {FileInfo} from '@mattermost/types/files';

import {Client4} from 'mattermost-redux/client';

import {fileSizeToString} from 'utils/utils';

// Match dailyReportFileTypes and DailyReportMaxFiles on the server, which stays the authority.
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'webm', 'pdf'];
export const MAX_FILES = 10;

const extensionOf = (name: string) => {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export function kindOf(file: FileInfo): 'image' | 'video' | 'file' {
    const mime = file.mime_type ?? '';
    if (mime.startsWith('image/')) {
        return 'image';
    }
    return mime.startsWith('video/') ? 'video' : 'file';
}

const typeLabel = (file: FileInfo) => (file.extension || extensionOf(file.name)).toUpperCase();

const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Thumb({file, reportId}: {file: FileInfo; reportId?: string}) {
    const [length, setLength] = useState<number>();
    const kind = kindOf(file);
    if (!reportId || kind === 'file') {
        return (
            <span className='DailyReportMedia__thumb'>
                <i className={kind === 'file' ? 'icon icon-file-pdf-outline' : 'icon icon-file-outline'}/>
            </span>
        );
    }
    const url = Client4.getDailyReportFileUrl(reportId, file.id);
    if (kind === 'image') {
        return (
            <span className='DailyReportMedia__thumb'>
                <img
                    alt=''
                    src={file.has_preview_image ? Client4.getDailyReportFileUrl(reportId, file.id, 'thumbnail') : url}
                />
            </span>
        );
    }

    // The first frame stands in for a thumbnail; metadata also gives the duration.
    return (
        <span className='DailyReportMedia__thumb'>
            <video
                src={url}
                preload='metadata'
                muted={true}
                onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
            />
            <i className='icon icon-play'/>
            {length !== undefined && Number.isFinite(length) && <span className='DailyReportMedia__duration'>{duration(length)}</span>}
        </span>
    );
}

type Pending = {key: number; name: string; size: number; progress: number; error?: string};

type Props = {
    files: FileInfo[];

    /** the report the files belong to; missing until the first upload of the day creates the draft */
    reportId?: string;
    upload: (file: File, onProgress: (loaded: number, total: number) => void) => Promise<FileInfo>;

    /** called after each successful upload or removal so the parent refetches the report */
    onChange: () => void;
    disabled?: boolean;
};

export type MediaSectionHandle = {add: (files: FileList | File[]) => void};

// MediaSection lists a report's attachments and takes new ones by drop, picker, or (through add) paste.
const MediaSection = forwardRef<MediaSectionHandle, Props>(({files, reportId, upload, onChange, disabled}, ref) => {
    const {formatMessage} = useIntl();
    const picker = useRef<HTMLInputElement>(null);
    const nextKey = useRef(0);
    const [pending, setPending] = useState<Pending[]>([]);
    const [added, setAdded] = useState<FileInfo[]>([]);
    const [removed, setRemoved] = useState<string[]>([]);
    const [error, setError] = useState('');

    // Uploads stay listed until the parent's refetch brings them in through files.
    const shown = [...files, ...added.filter((a) => !files.some((f) => f.id === a.id))].filter((f) => !removed.includes(f.id));

    const patch = (key: number, change: Partial<Pending> | null) => {
        setPending((list) => (change ? list.map((p) => (p.key === key ? {...p, ...change} : p)) : list.filter((p) => p.key !== key)));
    };

    const add = (list: FileList | File[]) => {
        if (disabled) {
            return;
        }
        let room = MAX_FILES - shown.length - pending.filter((p) => !p.error).length;
        const queued: Pending[] = [];
        for (const file of Array.from(list)) {
            const item: Pending = {key: ++nextKey.current, name: file.name, size: file.size, progress: 0};
            queued.push(item);
            if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
                item.error = formatMessage({id: 'daily_reports.media.badType', defaultMessage: 'This file type can\'t be attached.'});
                continue;
            }
            if (room <= 0) {
                item.error = formatMessage({id: 'daily_reports.media.tooMany', defaultMessage: 'A report can have at most {max} attachments.'}, {max: MAX_FILES});
                continue;
            }
            room--;
            upload(file, (loaded, total) => patch(item.key, {progress: total ? loaded / total : 0})).then(
                (info) => {
                    patch(item.key, null);
                    setAdded((a) => [...a, info]);
                    onChange();
                },
                (e: Error) => patch(item.key, {error: e.message}),
            );
        }
        setPending((list) => [...list, ...queued]);
    };

    useImperativeHandle(ref, () => ({add}));

    const remove = async (file: FileInfo) => {
        if (!reportId) {
            return;
        }
        try {
            await Client4.deleteDailyReportFile(reportId, file.id);
            setRemoved((r) => [...r, file.id]);
            setAdded((a) => a.filter((f) => f.id !== file.id));
            setError('');
            onChange();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const removeButton = (name: string, onClick: () => void) => (
        <button
            className='DailyReportMedia__remove'
            aria-label={formatMessage({id: 'daily_reports.media.remove', defaultMessage: 'Remove {name}'}, {name})}
            onClick={onClick}
        >
            <i className='icon icon-close'/>
        </button>
    );

    return (
        <div className='DailyReportMedia'>
            <div className='DailyReportMedia__head'>
                <i className='icon icon-image-outline'/>
                <strong>
                    <FormattedMessage
                        id='daily_reports.media.title'
                        defaultMessage='Media'
                    />
                </strong>
                <span>
                    <FormattedMessage
                        id='daily_reports.media.hint'
                        defaultMessage='Add screenshots, video clips or files to your daily report.'
                    />
                </span>
            </div>
            <div className='DailyReportMedia__columns'>
                {!disabled && (
                    <div
                        className='DailyReportMedia__drop'
                        data-testid='dailyReportDropZone'
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            add(e.dataTransfer.files);
                        }}
                    >
                        <i className='icon icon-cloud-upload-outline'/>
                        <span>
                            <FormattedMessage
                                id='daily_reports.media.drop'
                                defaultMessage='Drag and drop files or <choose>choose</choose>'
                                values={{
                                    choose: (chunks: React.ReactNode) => (
                                        <button
                                            type='button'
                                            className='btn btn-link DailyReportMedia__choose'
                                            onClick={() => picker.current?.click()}
                                        >
                                            {chunks}
                                        </button>
                                    ),
                                }}
                            />
                        </span>
                        <span className='DailyReportMedia__types'>
                            <FormattedMessage
                                id='daily_reports.media.types'
                                defaultMessage='PNG, JPG, GIF, WEBP, MP4, MOV, WEBM or PDF'
                            />
                        </span>
                        <input
                            ref={picker}
                            type='file'
                            multiple={true}
                            hidden={true}
                            accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
                            onChange={(e) => {
                                if (e.target.files) {
                                    add(e.target.files);
                                }
                                e.target.value = '';
                            }}
                        />
                    </div>
                )}
                <div className='DailyReportMedia__list'>
                    <span className='DailyReportMedia__count'>
                        <FormattedMessage
                            id='daily_reports.media.added'
                            defaultMessage='Attached media ({count})'
                            values={{count: shown.length}}
                        />
                    </span>
                    {error && <span className='DailyReportMedia__error'>{error}</span>}
                    <ul>
                        {shown.map((f) => (
                            <li
                                key={f.id}
                                className='DailyReportMedia__item'
                            >
                                <Thumb
                                    file={f}
                                    reportId={reportId}
                                />
                                <span className='DailyReportMedia__meta'>
                                    <span className='DailyReportMedia__name'>{f.name}</span>
                                    <span className='DailyReportMedia__info'>{`${fileSizeToString(f.size)} · ${typeLabel(f)}`}</span>
                                </span>
                                {!disabled && reportId && removeButton(f.name, () => remove(f))}
                            </li>
                        ))}
                        {pending.map((p) => (
                            <li
                                key={`pending-${p.key}`}
                                className='DailyReportMedia__item'
                            >
                                <span className='DailyReportMedia__thumb'>
                                    <i className={p.error ? 'icon icon-alert-outline' : 'icon icon-loading'}/>
                                </span>
                                <span className='DailyReportMedia__meta'>
                                    <span className='DailyReportMedia__name'>{p.name}</span>
                                    {p.error ? (
                                        <span className='DailyReportMedia__error'>{p.error}</span>
                                    ) : (
                                        <progress
                                            value={p.progress}
                                            max={1}
                                        />
                                    )}
                                </span>
                                {p.error && removeButton(p.name, () => patch(p.key, null))}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
});
MediaSection.displayName = 'MediaSection';

export default MediaSection;
