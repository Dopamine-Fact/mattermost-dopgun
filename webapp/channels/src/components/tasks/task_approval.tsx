// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {Button} from '@mattermost/compass-ui/components/button';
import type {Task, TaskApprovalAction} from '@mattermost/types/tasks';

import {Permissions} from 'mattermost-redux/constants';
import {haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';

import {applyTaskApproval} from 'actions/tasks';

import type {GlobalState} from 'types/store';

import {ApprovalBadge, useApprovalEnabled} from './task_bits';

// TaskApproval shows where a done task is in the supervisor → director chain, with the step the viewer may take.
const TaskApproval = ({task}: {task: Task}) => {
    const dispatch = useDispatch();
    const approvalEnabled = useApprovalEnabled(task.team_id);
    const canSupervisor = useSelector((state: GlobalState) => haveITeamPermission(state, task.team_id, Permissions.APPROVE_TASK_SUPERVISOR));
    const canDirector = useSelector((state: GlobalState) => haveITeamPermission(state, task.team_id, Permissions.APPROVE_TASK_DIRECTOR));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const status = task.approval_status;
    if (task.video_file_id || !status || (status === 'approved' && !approvalEnabled)) {
        return null;
    }
    const canDecide = (status === 'pending_supervisor' && canSupervisor) || (status === 'pending_director' && canDirector);
    const canRevert = status === 'approved' && canDirector;

    const act = async (action: TaskApprovalAction) => {
        setBusy(true);
        setError('');
        const result = await dispatch(applyTaskApproval(task.id, action)) as {error?: {message?: string}};
        setBusy(false);
        if (result.error) {
            setError(result.error.message ?? '');
        }
    };

    return (
        <div className='TaskDetail__approval'>
            <ApprovalBadge task={task}/>
            {canDecide && (
                <>
                    <Button
                        size='small'
                        disabled={busy}
                        onClick={() => act('approve')}
                    >
                        <FormattedMessage
                            id='tasks.approval.approve'
                            defaultMessage='Approve'
                        />
                    </Button>
                    <Button
                        size='small'
                        emphasis='tertiary'
                        destructive={true}
                        disabled={busy}
                        onClick={() => act('reject')}
                    >
                        <FormattedMessage
                            id='tasks.approval.reject'
                            defaultMessage='Send back'
                        />
                    </Button>
                </>
            )}
            {canRevert && (
                <Button
                    size='small'
                    emphasis='tertiary'
                    disabled={busy}
                    onClick={() => act('revert')}
                >
                    <FormattedMessage
                        id='tasks.approval.revert'
                        defaultMessage='Reopen'
                    />
                </Button>
            )}
            {error && (
                <p
                    className='TaskDetail__error'
                    role='alert'
                >
                    {error}
                </p>
            )}
        </div>
    );
};

export default TaskApproval;
