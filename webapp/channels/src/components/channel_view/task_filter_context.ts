// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

// TaskFilterContext carries the task the Messages tab is filtered to ('' = all), so the composer can follow it.
const TaskFilterContext = React.createContext<string>('');

export default TaskFilterContext;
