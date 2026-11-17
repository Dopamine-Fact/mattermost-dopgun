// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {GenericModal} from '@mattermost/components';
import type {DailyReport} from '@mattermost/types/daily_reports';

import {Client4} from 'mattermost-redux/client';

import {REASON_MAX_LENGTH} from './common';

type Props = {
    report: DailyReport;
    onExited: () => void;

    /** called after the server accepted the rejection, or answered that the report changed */
    onDone: () => void;
};

// RejectModal sends a report back to its author; the reason is required and shown to them.
const RejectModal = ({report, onExited, onDone}: Props) => {
    const {formatMessage} = useIntl();
    const [show, setShow] = useState(true);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const confirm = async () => {
        if (!reason.trim() || busy) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            await Client4.rejectDailyReport(report.id, reason.trim(), report.update_at);
            setShow(false);
            onDone();
        } catch (e) {
            setError((e as Error).message);

            // 409: the author edited it meanwhile; refresh the list behind the modal so the reviewer sees the new text.
            onDone();
        }
        setBusy(false);
    };

    return (
        <GenericModal
            id='dailyReportRejectModal'
            className='DailyReportRejectModal'
            modalHeaderText={formatMessage({id: 'daily_reports.rejectModal.title', defaultMessage: 'Send report back'})}
            show={show}
            onExited={onExited}
            onHide={() => setShow(false)}
            handleCancel={() => setShow(false)}
            handleConfirm={confirm}
            confirmButtonText={formatMessage({id: 'daily_reports.reject', defaultMessage: 'Reject'})}
            destructive={true}
            isConfirmDisabled={!reason.trim() || busy}
            isConfirmLoading={busy}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            errorText={error || undefined}
        >
            <div className='DailyReportsModal__body'>
                <label htmlFor='dailyReportRejectReason'>
                    <FormattedMessage
                        id='daily_reports.rejectModal.reason'
                        defaultMessage='Reason'
                    />
                </label>
                <textarea
                    id='dailyReportRejectReason'
                    className='form-control'
                    rows={4}
                    autoFocus={true}
                    maxLength={REASON_MAX_LENGTH}
                    placeholder={formatMessage({id: 'daily_reports.rejectModal.placeholder', defaultMessage: 'What needs fixing? The author sees this.'})}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                />
            </div>
        </GenericModal>
    );
};

export default RejectModal;
