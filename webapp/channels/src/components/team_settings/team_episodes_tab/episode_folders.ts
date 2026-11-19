// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Mirrors the server's model.EpisodeFolder; the server validator (model.isValidEpisodeFolders) is the authority.
export type EpisodeFolder = {
    path: string;
    view_departments?: string[];
    write_departments?: string[];
    read_only?: boolean;
    mirror_of?: string;
};

export const MAX_EPISODE_FOLDERS = 100;

const NEW_FOLDER_NAME = 'New folder';

const isUnder = (path: string, root: string) => path === root || path.startsWith(root + '/');

// Same rules as the server's IsValidDriveItemName.
const NAME_MAX_RUNES = 255;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/;
export const isValidFolderName = (name: string) => (
    name !== '' && name !== '.' && name !== '..' && [...name].length <= NAME_MAX_RUNES &&
    !name.startsWith(' ') && !name.endsWith(' ') && !name.endsWith('.') && !FORBIDDEN_NAME_CHARS.test(name)
);

// Matches the server's TeamEpisodeFoldersMaxRunes.
export const MAX_EPISODE_FOLDERS_RUNES = 100000;

export const episodeFoldersTooLarge = (folders: EpisodeFolder[]) => [...serializeEpisodeFolders(folders)].length > MAX_EPISODE_FOLDERS_RUNES;

export const parentPath = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

export const folderName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Reads the JSON template, or else (like the server) the old one-path-per-line text as rule-less entries. */
export function parseEpisodeFolders(text?: string): EpisodeFolder[] {
    const value = (text ?? '').trim();
    if (value.startsWith('[')) {
        try {
            return JSON.parse(value) as EpisodeFolder[];
        } catch {
            // not JSON: an old text template whose first line starts with "["
        }
    }
    const seen = new Set<string>();
    return value.split('\n').map((line) => line.trim()).filter((line) => {
        const key = line.toLowerCase();
        if (!line || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    }).map((path) => ({path}));
}

/** The JSON the server stores; '' for no folders. Empty rule fields are left out. */
export function serializeEpisodeFolders(folders: EpisodeFolder[]): string {
    if (!folders.length) {
        return '';
    }
    return JSON.stringify(folders.map((f) => {
        const out: EpisodeFolder = {path: f.path};
        if (f.view_departments?.length) {
            out.view_departments = f.view_departments;
        }
        if (f.write_departments?.length) {
            out.write_departments = f.write_departments;
        }
        if (f.read_only) {
            out.read_only = true;
        }
        if (f.mirror_of) {
            out.mirror_of = f.mirror_of;
        }
        return out;
    }));
}

/** True when a sibling under the same parent already has this name, ignoring case. */
export const folderNameTaken = (folders: EpisodeFolder[], parent: string, name: string, except?: string) => {
    const path = (parent ? parent + '/' : '') + name;
    return folders.some((f) => f.path !== except && f.path.toLowerCase() === path.toLowerCase());
};

/** Adds "New folder" (or "New folder (2)"…) under parentPath ('' for the top level). */
export function addEpisodeFolder(folders: EpisodeFolder[], parent: string): {folders: EpisodeFolder[]; path: string} {
    let name = NEW_FOLDER_NAME;
    for (let n = 2; folderNameTaken(folders, parent, name); n++) {
        name = `${NEW_FOLDER_NAME} (${n})`;
    }
    const path = (parent ? parent + '/' : '') + name;
    return {folders: [...folders, {path}], path};
}

/** Renames a folder, moving its descendants and every mirror_of that points into it. */
export function renameEpisodeFolder(folders: EpisodeFolder[], path: string, name: string): EpisodeFolder[] {
    const parent = parentPath(path);
    const next = (parent ? parent + '/' : '') + name;
    const move = (p: string) => next + p.slice(path.length);
    return folders.map((f) => {
        const out = {...f};
        if (isUnder(f.path, path)) {
            out.path = move(f.path);
        }
        if (f.mirror_of && isUnder(f.mirror_of, path)) {
            out.mirror_of = move(f.mirror_of);
        }
        return out;
    });
}

/** Removes a folder with its subfolders, and clears the mirror_of of folders that mirrored any of them. */
export function removeEpisodeFolder(folders: EpisodeFolder[], path: string): EpisodeFolder[] {
    return folders.filter((f) => !isUnder(f.path, path)).map((f) => {
        if (!f.mirror_of || !isUnder(f.mirror_of, path)) {
            return f;
        }
        const rest = {...f};
        delete rest.mirror_of;
        return rest;
    });
}

/** Folders that `path` may mirror: not itself, not a mirror, not an ancestor or descendant. */
export function mirrorSources(folders: EpisodeFolder[], path: string): string[] {
    return folders.filter((f) => !f.mirror_of && !isUnder(f.path, path) && !isUnder(path, f.path)).map((f) => f.path);
}
