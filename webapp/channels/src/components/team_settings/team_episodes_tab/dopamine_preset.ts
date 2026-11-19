// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Department} from '@mattermost/types/custom_roles';

import type {EpisodeFolder} from './episode_folders';
import type {EpisodeTask} from './episode_tasks';

// The Dopamine studio's episode template (copied from NextDopgun): one department per production stage, its folder
// tree with read-only mirrors of earlier stages' exports, and the tasks that fill it. Departments are named, not
// referenced by id, so the preset can be loaded into any team.

export const DOPAMINE_DEPARTMENTS: Array<{name: string; color: string}> = [
    {name: 'Script / Senaryo', color: '#3b82f6'},
    {name: 'Animatic / Animatik', color: '#f97316'},
    {name: 'Vis-Dev', color: '#22c55e'},
    {name: 'Animation / Animasyon', color: '#8b5cf6'},
    {name: 'Compositing', color: '#eab308'},
    {name: 'Audio / Ses', color: '#d946ef'},
    {name: 'Editing / Kurgu', color: '#0ea5e9'},
    {name: 'Delivery / Teslim', color: '#6366f1'},
];

export const DOPAMINE_FOLDERS: EpisodeFolder[] = [
    {path: '01_SCRIPT'},
    {path: '01_SCRIPT/ASSETS'},
    {path: '01_SCRIPT/EXPORTS'},
    {path: '02_ANIMATIC'},
    {path: '02_ANIMATIC/ASSETS'},
    {path: '02_ANIMATIC/ASSETS/SCRIPT', mirror_of: '01_SCRIPT/EXPORTS', read_only: true},
    {path: '02_ANIMATIC/ASSETS/CONCEPT_ART', mirror_of: '03_VIS-DEV/EXPORTS/CONCEPT_ART', read_only: true},
    {path: '02_ANIMATIC/ASSETS/CHARACTER_DESIGN', mirror_of: '03_VIS-DEV/EXPORTS/CHARACTER_DESIGN', read_only: true},
    {path: '02_ANIMATIC/ASSETS/SONG', mirror_of: '06_AUDIO/EXPORTS/SONG', read_only: true},
    {path: '02_ANIMATIC/ASSETS/PILOT_VOICE', mirror_of: '06_AUDIO/EXPORTS/PILOT_VOICE', read_only: true},
    {path: '02_ANIMATIC/ASSETS/BG_LIBRARY'},
    {path: '02_ANIMATIC/EXPORTS'},
    {path: '02_ANIMATIC/EXPORTS/BOARDS'},
    {path: '02_ANIMATIC/EXPORTS/SHOTS'},
    {path: '02_ANIMATIC/EXPORTS/ANIMATIC'},
    {path: '02_ANIMATIC/EXPORTS/BREAKDOWN'},
    {path: '03_VIS-DEV'},
    {path: '03_VIS-DEV/ASSETS'},
    {path: '03_VIS-DEV/ASSETS/BOARDS', mirror_of: '02_ANIMATIC/EXPORTS/BOARDS', read_only: true},
    {path: '03_VIS-DEV/ASSETS/SHOTS', mirror_of: '02_ANIMATIC/EXPORTS/SHOTS', read_only: true},
    {path: '03_VIS-DEV/ASSETS/ANIMATIC', mirror_of: '02_ANIMATIC/EXPORTS/ANIMATIC', read_only: true},
    {path: '03_VIS-DEV/ASSETS/BREAKDOWN', mirror_of: '02_ANIMATIC/EXPORTS/BREAKDOWN', read_only: true},
    {path: '03_VIS-DEV/ASSETS/BG_LIBRARY'},
    {path: '03_VIS-DEV/EXPORTS'},
    {path: '03_VIS-DEV/EXPORTS/CONCEPT_ART'},
    {path: '03_VIS-DEV/EXPORTS/CHARACTER_DESIGN'},
    {path: '03_VIS-DEV/EXPORTS/MODELSHEETS'},
    {path: '03_VIS-DEV/EXPORTS/RIGS'},
    {path: '03_VIS-DEV/EXPORTS/PROP_DESIGN'},
    {path: '03_VIS-DEV/EXPORTS/PROP_BUILD'},
    {path: '03_VIS-DEV/EXPORTS/LAYOUTS'},
    {path: '03_VIS-DEV/EXPORTS/BG'},
    {path: '03_VIS-DEV/EXPORTS/ILLUSTRATIONS'},
    {path: '04_ANIMATION'},
    {path: '04_ANIMATION/ASSETS'},
    {path: '04_ANIMATION/ASSETS/ANIMATIC', mirror_of: '02_ANIMATIC/EXPORTS/ANIMATIC', read_only: true},
    {path: '04_ANIMATION/ASSETS/BREAKDOWN', mirror_of: '02_ANIMATIC/EXPORTS/BREAKDOWN', read_only: true},
    {path: '04_ANIMATION/ASSETS/RIGS', mirror_of: '03_VIS-DEV/EXPORTS/RIGS', read_only: true},
    {path: '04_ANIMATION/ASSETS/PROP_BUILD', mirror_of: '03_VIS-DEV/EXPORTS/PROP_BUILD', read_only: true},
    {path: '04_ANIMATION/ASSETS/LAYOUTS', mirror_of: '03_VIS-DEV/EXPORTS/LAYOUTS', read_only: true},
    {path: '04_ANIMATION/EXPORTS'},
    {path: '04_ANIMATION/EXPORTS/PROJECT_FILES'},
    {path: '04_ANIMATION/EXPORTS/PREVIEWS'},
    {path: '04_ANIMATION/EXPORTS/RENDERS'},
    {path: '05_COMPOSITING'},
    {path: '05_COMPOSITING/ASSETS'},
    {path: '05_COMPOSITING/ASSETS/ANIMATIC', mirror_of: '02_ANIMATIC/EXPORTS/ANIMATIC', read_only: true},
    {path: '05_COMPOSITING/ASSETS/BG', mirror_of: '03_VIS-DEV/EXPORTS/BG', read_only: true},
    {path: '05_COMPOSITING/ASSETS/ILLUSTRATIONS', mirror_of: '03_VIS-DEV/EXPORTS/ILLUSTRATIONS', read_only: true},
    {path: '05_COMPOSITING/ASSETS/RENDERS', mirror_of: '04_ANIMATION/EXPORTS/RENDERS', read_only: true},
    {path: '05_COMPOSITING/ASSETS/ROUGH_CUT', mirror_of: '07_EDIT/EXPORTS/ROUGH_CUT', read_only: true},
    {path: '05_COMPOSITING/EXPORTS'},
    {path: '05_COMPOSITING/EXPORTS/PROJECT_FILES'},
    {path: '05_COMPOSITING/EXPORTS/AE_RENDERS'},
    {path: '06_AUDIO'},
    {path: '06_AUDIO/ASSETS'},
    {path: '06_AUDIO/ASSETS/SCRIPT', mirror_of: '01_SCRIPT/EXPORTS', read_only: true},
    {path: '06_AUDIO/ASSETS/ROUGH_CUT', mirror_of: '07_EDIT/EXPORTS/ROUGH_CUT', read_only: true},
    {path: '06_AUDIO/EXPORTS'},
    {path: '06_AUDIO/EXPORTS/PILOT_VOICE'},
    {path: '06_AUDIO/EXPORTS/SONG'},
    {path: '06_AUDIO/EXPORTS/VOICE_OVER'},
    {path: '06_AUDIO/EXPORTS/EFFECTS'},
    {path: '06_AUDIO/EXPORTS/MUSIC'},
    {path: '06_AUDIO/EXPORTS/MIX'},
    {path: '07_EDIT'},
    {path: '07_EDIT/ASSETS'},
    {path: '07_EDIT/ASSETS/AE_RENDERS', mirror_of: '05_COMPOSITING/EXPORTS/AE_RENDERS', read_only: true},
    {path: '07_EDIT/ASSETS/MIX', mirror_of: '06_AUDIO/EXPORTS/MIX', read_only: true},
    {path: '07_EDIT/ASSETS/VOICE_OVER', mirror_of: '06_AUDIO/EXPORTS/VOICE_OVER', read_only: true},
    {path: '07_EDIT/ASSETS/EFFECTS', mirror_of: '06_AUDIO/EXPORTS/EFFECTS', read_only: true},
    {path: '07_EDIT/ASSETS/MUSIC', mirror_of: '06_AUDIO/EXPORTS/MUSIC', read_only: true},
    {path: '07_EDIT/ASSETS/OUTRO'},
    {path: '07_EDIT/ASSETS/PREVIEWS', mirror_of: '04_ANIMATION/EXPORTS/PREVIEWS', read_only: true},
    {path: '07_EDIT/EXPORTS'},
    {path: '07_EDIT/EXPORTS/ROUGH_CUT'},
    {path: '07_EDIT/EXPORTS/SUBTITLES'},
    {path: '07_EDIT/EXPORTS/PR_RENDER'},
    {path: '08_FINAL'},
    {path: '09_REVISION'},
    {path: '09_REVISION/DIRECTOR'},
    {path: '09_REVISION/CHANNEL'},
    {path: '10_BROADCAST'},
    {path: '11_ARCHIVE'},

    // A read-only view of every top-level folder in one place.
    {path: '06_ARCHIVE'},
    ...['01_SCRIPT', '02_ANIMATIC', '03_VIS-DEV', '04_ANIMATION', '05_COMPOSITING', '06_AUDIO', '07_EDIT', '08_FINAL', '09_REVISION', '10_BROADCAST', '11_ARCHIVE'].
        map((path) => ({path: `06_ARCHIVE/${path}`, mirror_of: path, read_only: true})),
];

type PresetTask = Omit<EpisodeTask, 'department_id'> & {department: string};

const DOPAMINE_TASKS: PresetTask[] = [
    {key: 'treatment', title: 'Treatment', department: 'Script / Senaryo'},
    {key: 'draft', title: 'Draft', department: 'Script / Senaryo', waits_for: ['treatment']},
    {key: 'approved', title: 'Approved', department: 'Script / Senaryo', waits_for: ['draft'], folder: '01_SCRIPT/EXPORTS'},
    {key: 'translation', title: 'Translation', department: 'Script / Senaryo', waits_for: ['approved'], folder: '01_SCRIPT/EXPORTS'},
    {key: 'board', title: 'Board', department: 'Animatic / Animatik', waits_for: ['animatic'], folder: '02_ANIMATIC/EXPORTS/BOARDS'},
    {key: 'shots', title: 'Shots', department: 'Animatic / Animatik', folder: '02_ANIMATIC/EXPORTS/SHOTS'},
    {key: 'animatic', title: 'Animatic', department: 'Animatic / Animatik', waits_for: ['shots'], folder: '02_ANIMATIC/EXPORTS/ANIMATIC'},
    {key: 'breakdown', title: 'Breakdown', department: 'Animatic / Animatik', waits_for: ['animatic'], folder: '02_ANIMATIC/EXPORTS/BREAKDOWN'},
    {key: 'concept_art', title: 'Concept_Art', department: 'Vis-Dev', waits_for: ['approved'], folder: '03_VIS-DEV/EXPORTS/CONCEPT_ART'},
    {key: 'character_design', title: 'Character_Design', department: 'Vis-Dev', waits_for: ['approved'], folder: '03_VIS-DEV/EXPORTS/CHARACTER_DESIGN'},
    {key: 'modelsheet', title: 'Modelsheet', department: 'Vis-Dev', waits_for: ['character_design'], folder: '03_VIS-DEV/EXPORTS/MODELSHEETS'},
    {key: 'rigs', title: 'Rigs', department: 'Vis-Dev', waits_for: ['modelsheet'], folder: '03_VIS-DEV/EXPORTS/RIGS'},
    {key: 'props_design', title: 'Props · Design', department: 'Vis-Dev', waits_for: ['animatic'], folder: '03_VIS-DEV/EXPORTS/PROP_DESIGN'},
    {key: 'props_build', title: 'Props · Build', department: 'Vis-Dev', waits_for: ['props_design'], folder: '03_VIS-DEV/EXPORTS/PROP_BUILD'},
    {key: 'lay_out', title: 'Lay_Out', department: 'Vis-Dev', waits_for: ['shots'], folder: '03_VIS-DEV/EXPORTS/LAYOUTS'},
    {key: 'background', title: 'Background', department: 'Vis-Dev', waits_for: ['lay_out'], folder: '03_VIS-DEV/EXPORTS/BG'},
    {key: 'illustration', title: 'Illustration', department: 'Vis-Dev', waits_for: ['animatic'], folder: '03_VIS-DEV/EXPORTS/ILLUSTRATIONS'},
    {key: 'animate', title: 'Animate', department: 'Animation / Animasyon', waits_for: ['animatic', 'rigs', 'props_build'], folder: '04_ANIMATION/EXPORTS/PROJECT_FILES'},
    {key: 'previews', title: 'Previews', department: 'Animation / Animasyon', waits_for: ['animate'], folder: '04_ANIMATION/EXPORTS/PREVIEWS'},
    {key: 'renders', title: 'Renders', department: 'Animation / Animasyon', waits_for: ['animate'], folder: '04_ANIMATION/EXPORTS/RENDERS'},
    {key: 'scene_setup', title: 'Scene_Setup', department: 'Compositing', waits_for: ['animatic', 'background', 'rough_cut']},
    {key: 'composite', title: 'Composite', department: 'Compositing', waits_for: ['renders', 'scene_setup', 'background'], folder: '05_COMPOSITING/EXPORTS/PROJECT_FILES'},
    {key: 'ae_renders', title: 'AE_Renders', department: 'Compositing', waits_for: ['composite'], folder: '05_COMPOSITING/EXPORTS/AE_RENDERS'},
    {key: 'pilot_voice_recording', title: 'Pilot Voice / Recording', department: 'Audio / Ses', waits_for: ['approved'], folder: '06_AUDIO/EXPORTS/PILOT_VOICE'},
    {key: 'pilot_voice_cleanup', title: 'Pilot Voice / Cleanup', department: 'Audio / Ses', waits_for: ['pilot_voice_recording']},
    {key: 'song_brief_ark_varsa', title: 'Song / Brief (şarkı varsa)', department: 'Audio / Ses', waits_for: ['approved']},
    {key: 'song_draft_ark_varsa', title: 'Song / Draft (şarkı varsa)', department: 'Audio / Ses', waits_for: ['song_brief_ark_varsa']},
    {key: 'song_final_ark_varsa', title: 'Song / Final (şarkı varsa)', department: 'Audio / Ses', waits_for: ['song_draft_ark_varsa'], folder: '06_AUDIO/EXPORTS/SONG'},
    {key: 'song_versions_ark_varsa', title: 'Song / Versions (şarkı varsa)', department: 'Audio / Ses', waits_for: ['song_final_ark_varsa']},
    {key: 'voice_over_booking', title: 'Voice Over / Booking', department: 'Audio / Ses', waits_for: ['rough_cut', 'approved']},
    {key: 'voice_over_recording', title: 'Voice Over / Recording', department: 'Audio / Ses', waits_for: ['voice_over_booking']},
    {key: 'voice_over_export', title: 'Voice Over / Export', department: 'Audio / Ses', waits_for: ['voice_over_recording'], folder: '06_AUDIO/EXPORTS/VOICE_OVER'},
    {key: 'effects', title: 'Effects', department: 'Audio / Ses', waits_for: ['rough_cut'], folder: '06_AUDIO/EXPORTS/EFFECTS'},
    {key: 'music', title: 'Music', department: 'Audio / Ses', waits_for: ['rough_cut'], folder: '06_AUDIO/EXPORTS/MUSIC'},
    {key: 'mix', title: 'Mix', department: 'Audio / Ses', waits_for: ['voice_over_export', 'effects', 'music', 'song_versions_ark_varsa'], folder: '06_AUDIO/EXPORTS/MIX'},
    {key: 'rough_cut', title: 'Rough_Cut', department: 'Editing / Kurgu', waits_for: ['previews'], folder: '07_EDIT/EXPORTS/ROUGH_CUT'},
    {key: 'subtitles_translation', title: 'Subtitles / Translation', department: 'Editing / Kurgu', waits_for: ['rough_cut'], folder: '07_EDIT/EXPORTS/SUBTITLES'},
    {key: 'subtitles_sync', title: 'Subtitles / Sync', department: 'Editing / Kurgu', waits_for: ['subtitles_translation']},
    {key: 'outro_edit', title: 'Outro_Edit', department: 'Editing / Kurgu', waits_for: ['voice_over_export'], folder: '07_EDIT/ASSETS/OUTRO'},
    {key: 'pr_editing', title: 'Pr_Editing', department: 'Editing / Kurgu', waits_for: ['outro_edit', 'ae_renders', 'mix', 'subtitles_sync'], folder: '07_EDIT/EXPORTS/PR_RENDER'},
    {key: 'director_revisions', title: 'Director_Revisions', department: 'Editing / Kurgu', waits_for: ['pr_editing'], folder: '09_REVISION/DIRECTOR'},
    {key: 'master', title: 'Master', department: 'Delivery / Teslim', waits_for: ['director_revisions'], folder: '08_FINAL'},
    {key: 'channel_delivery', title: 'Channel Delivery', department: 'Delivery / Teslim', waits_for: ['master'], folder: '09_REVISION/CHANNEL'},
    {key: 'channel_approval', title: 'Channel Approval', department: 'Delivery / Teslim', waits_for: ['channel_delivery']},
    {key: 'broadcast', title: 'Broadcast', department: 'Delivery / Teslim', waits_for: ['channel_approval'], folder: '10_BROADCAST'},
    {key: 'archive', title: 'Archive', department: 'Delivery / Teslim', waits_for: ['broadcast'], folder: '11_ARCHIVE'},
];

/** The preset's folders and tasks, each task given the id of the team department with its department's name (case-insensitive). */
export function buildDopamineTemplate(departments: Department[]): {folders: EpisodeFolder[]; tasks: EpisodeTask[]} {
    const ids = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
    const tasks = DOPAMINE_TASKS.map(({department, ...task}) => {
        const id = ids.get(department.toLowerCase());
        return id ? {...task, department_id: id} : task;
    });
    return {folders: DOPAMINE_FOLDERS.map((f) => ({...f})), tasks};
}
