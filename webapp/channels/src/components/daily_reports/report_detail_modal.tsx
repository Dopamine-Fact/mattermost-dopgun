// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';
import type {DailyReport} from '@mattermost/types/daily_reports';

import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentUserId, getUser} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import ExternalLink from 'components/external_link';
import Markdown from 'components/markdown';
import type {Props as PDFPreviewProps} from 'components/pdf_preview';

import type {GlobalState} from 'types/store';

import {PreviouslyRejected, RejectedBanner, ReportDate, StatusChip, TaskChips} from './common';
import {kindOf} from './media_section';

const PDFPreview = React.lazy<React.ComponentType<PDFPreviewProps>>(() => import('components/pdf_preview'));

// Images open in a new tab and PDFs inline; the stock file preview assumes post attachments.
function Gallery({report}: {report: DailyReport}) {
    const {formatMessage} = useIntl();
    const [openPdf, setOpenPdf] = useState('');
    if (!report.files?.length) {
        return null;
    }
    return (
        <ul className='DailyReportDetail__gallery'>
            {report.files.map((f) => {
                const url = Client4.getDailyReportFileUrl(report.id, f.id);
                const kind = kindOf(f);
                return (
                    <li key={f.id}>
                        {kind === 'video' && (
                            <video
                                src={url}
                                controls={true}
                                preload='metadata'
                            />
                        )}
                        {kind === 'image' && (
                            <ExternalLink
                                href={url}
                                location='daily_report_detail'
                            >
                                <img
                                    alt={f.name}
                                    src={f.has_preview_image ? Client4.getDailyReportFileUrl(report.id, f.id, 'preview') : url}
                                />
                            </ExternalLink>
                        )}
                        {kind === 'file' && (
                            <div className='DailyReportDetail__file'>
                                <button
                                    type='button'
                                    className='btn btn-link'
                                    aria-expanded={openPdf === f.id}
                                    onClick={() => setOpenPdf(openPdf === f.id ? '' : f.id)}
                                >
                                    <i className='icon icon-file-pdf-outline'/>
                                    {f.name}
                                </button>
                                <ExternalLink
                                    href={url}
                                    location='daily_report_detail'
                                    aria-label={formatMessage({id: 'daily_reports.downloadFile', defaultMessage: 'Download {name}'}, {name: f.name})}
                                >
                                    <i className='icon icon-download-outline'/>
                                </ExternalLink>
                            </div>
                        )}
                        {kind === 'file' && openPdf === f.id && (
                            <div className='DailyReportDetail__pdf'>
                                <React.Suspense fallback={null}>
                                    <PDFPreview
                                        fileInfo={f}
                                        fileUrl={url}
                                        scale={1}
                                        handleBgClose={() => {}}
                                    />
                                </React.Suspense>
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

type Props = {
    report: DailyReport;
    onClose: () => void;

    /** buttons for the footer, such as Approve/Reject or Edit */
    actions?: React.ReactNode;

    /** replaces the read-only view, e.g. with an editor */
    children?: React.ReactNode;
};

// ReportDetailModal shows one report in full: author, date, status, text, tasks and attachments.
const ReportDetailModal = ({report, onClose, actions, children}: Props) => {
    const [show, setShow] = useState(true);
    const author = useSelector((state: GlobalState) => getUser(state, report.user_id));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const own = useSelector(getCurrentUserId) === report.user_id;

    return (
        <GenericModal
            id='dailyReportDetailModal'
            className='DailyReportDetail'
            modalHeaderText={<ReportDate date={report.date}/>}
            show={show}
            onExited={onClose}
            onHide={() => setShow(false)}
            compassDesign={true}
            footerContent={actions}
        >
            {children ?? (
                <div className='DailyReportsModal__body'>
                    <div className='DailyReportDetail__meta'>
                        {author && <strong>{displayUsername(author, nameDisplay)}</strong>}
                        <StatusChip
                            report={report}
                            own={own}
                        />
                    </div>
                    {report.status === 'rejected' && <RejectedBanner report={report}/>}
                    <PreviouslyRejected report={report}/>
                    <Markdown message={report.message}/>
                    <TaskChips tasks={report.tasks}/>
                    <Gallery report={report}/>
                </div>
            )}
        </GenericModal>
    );
};

export default ReportDetailModal;
