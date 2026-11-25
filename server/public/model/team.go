// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	TeamOpen                    = "O"
	TeamInvite                  = "I"
	TeamAllowedDomainsMaxLength = 500
	TeamCompanyNameMaxLength    = 64
	TeamDescriptionMaxLength    = 255
	TeamEpisodeTemplateMaxLines = 100
	// TeamEpisodeFoldersMaxRunes is the size limit of the folder and task templates: JSON with department ids and rules.
	TeamEpisodeFoldersMaxRunes = 100000
	TeamDisplayNameMaxRunes    = 64
	TeamEmailMaxLength         = 128
	TeamNameMaxLength          = 64
	TeamNameMinLength          = 2
)

type Team struct {
	Id                  string  `json:"id"`
	CreateAt            int64   `json:"create_at"`
	UpdateAt            int64   `json:"update_at"`
	DeleteAt            int64   `json:"delete_at"`
	DisplayName         string  `json:"display_name"`
	Name                string  `json:"name"`
	Description         string  `json:"description"`
	Email               string  `json:"email"`
	Type                string  `json:"type"`
	CompanyName         string  `json:"company_name"`
	AllowedDomains      string  `json:"allowed_domains"`
	InviteId            string  `json:"invite_id"`
	AllowOpenInvite     bool    `json:"allow_open_invite"`
	LastTeamIconUpdate  int64   `json:"last_team_icon_update,omitempty"`
	SchemeId            *string `json:"scheme_id"`
	GroupConstrained    *bool   `json:"group_constrained"`
	PolicyID            *string `json:"policy_id"` // Data Retention policy — unrelated to ABAC below
	CloudLimitsArchived bool    `json:"cloud_limits_archived"`
	TasksEnabled        bool    `json:"tasks_enabled"`
	RevisionsEnabled    bool    `json:"revisions_enabled"` // revision channels; only effective with TasksEnabled
	TaskApprovalEnabled bool    `json:"task_approval_enabled"`
	CanvasEnabled       bool    `json:"canvas_enabled"`
	DailyReportsEnabled bool    `json:"daily_reports_enabled"`
	DailyReportTime     string  `json:"daily_report_time"` // "HH:MM" in DailyReportTimezone
	DailyReportTimezone string  `json:"daily_report_timezone"`
	FilesEnabled        bool    `json:"files_enabled"`
	NotesEnabled        bool    `json:"notes_enabled"`
	EpisodeFolders      string  `json:"episode_folders"` // JSON folder list (or newline-separated paths) seeded into each new episode
	EpisodeTasks        string  `json:"episode_tasks"`   // JSON task list (or newline-separated titles) seeded into each new episode
	// FilesTemplate is the JSON folder layout of the team Files page (TeamFilesFolder list). Kept out of the team
	// JSON because it names folders hidden from members; read it through the files layout or template endpoints.
	FilesTemplate  string `json:"-"`
	FilesChannelId string `json:"files_channel_id"` // the private channel that stores the template's folders

	// Not persisted; derived by the store via EXISTS on AccessControlPolicies(Type='team').
	// Use HasMembershipPolicyAction for enforcement — this is a read-path signal only.
	PolicyEnforced bool            `json:"policy_enforced"`
	PolicyActions  map[string]bool `json:"policy_actions,omitempty"` // hydrated lazily; nil when not hydrated
	// PolicyAutoAdd reports whether the team's policy auto-adds qualifying
	// members, derived by the store from the policy's membership rule.
	PolicyAutoAdd bool `json:"policy_auto_add"`
	// PolicyIsActive carries the same value as PolicyAutoAdd.
	//
	// Deprecated: use PolicyAutoAdd. Auto-adding members is no longer tied to a
	// policy's active flag.
	PolicyIsActive bool `json:"policy_is_active"`

	// Not persisted; a transient per-viewer hint set on public, policy-enforced
	// teams the requesting user qualifies to join and is not already a member of.
	// Never set on private teams. Carries no policy detail.
	Recommended bool `json:"recommended,omitempty"`
}

// HasPolicyAction is nil-safe; returns false when PolicyActions is nil or empty.
func (o *Team) HasPolicyAction(action string) bool {
	if o == nil || len(o.PolicyActions) == 0 {
		return false
	}
	return o.PolicyActions[action]
}

func (o *Team) HasMembershipPolicyAction() bool {
	return o.HasPolicyAction(AccessControlPolicyActionMembership)
}

func (o *Team) Auditable() map[string]any {
	return map[string]any{
		"id":                    o.Id,
		"create_at":             o.CreateAt,
		"update_at":             o.UpdateAt,
		"delete_at":             o.DeleteAt,
		"type":                  o.Type,
		"invite_id":             o.InviteId,
		"allow_open_invite":     o.AllowOpenInvite,
		"scheme_id":             o.SchemeId,
		"group_constrained":     o.GroupConstrained,
		"policy_id":             o.PolicyID,
		"cloud_limits_archived": o.CloudLimitsArchived,
		"tasks_enabled":         o.TasksEnabled,
		"revisions_enabled":     o.RevisionsEnabled,
		"task_approval_enabled": o.TaskApprovalEnabled,
		"canvas_enabled":        o.CanvasEnabled,
		"daily_reports_enabled": o.DailyReportsEnabled,
		"daily_report_time":     o.DailyReportTime,
		"daily_report_timezone": o.DailyReportTimezone,
		"files_enabled":         o.FilesEnabled,
		"notes_enabled":         o.NotesEnabled,
		"episode_folders":       episodeFolderCount(o.EpisodeFolders),
		"episode_tasks":         len(ParseEpisodeTasks(o.EpisodeTasks)),
	}
}

func (o *Team) LogClone() any {
	return o.Auditable()
}

type TeamPatch struct {
	DisplayName         *string `json:"display_name"`
	Description         *string `json:"description"`
	CompanyName         *string `json:"company_name"`
	AllowedDomains      *string `json:"allowed_domains"`
	AllowOpenInvite     *bool   `json:"allow_open_invite"`
	GroupConstrained    *bool   `json:"group_constrained"`
	CloudLimitsArchived *bool   `json:"cloud_limits_archived"`
	TasksEnabled        *bool   `json:"tasks_enabled"`
	RevisionsEnabled    *bool   `json:"revisions_enabled"`
	TaskApprovalEnabled *bool   `json:"task_approval_enabled"`
	CanvasEnabled       *bool   `json:"canvas_enabled"`
	DailyReportsEnabled *bool   `json:"daily_reports_enabled"`
	DailyReportTime     *string `json:"daily_report_time"`
	DailyReportTimezone *string `json:"daily_report_timezone"`
	FilesEnabled        *bool   `json:"files_enabled"`
	NotesEnabled        *bool   `json:"notes_enabled"`
	EpisodeFolders      *string `json:"episode_folders"`
	EpisodeTasks        *string `json:"episode_tasks"`
}

func (o *TeamPatch) Auditable() map[string]any {
	return map[string]any{
		"allow_open_invite":     o.AllowOpenInvite,
		"group_constrained":     o.GroupConstrained,
		"cloud_limits_archived": o.CloudLimitsArchived,
		"tasks_enabled":         o.TasksEnabled,
		"revisions_enabled":     o.RevisionsEnabled,
		"task_approval_enabled": o.TaskApprovalEnabled,
		"canvas_enabled":        o.CanvasEnabled,
		"daily_reports_enabled": o.DailyReportsEnabled,
		"daily_report_time":     o.DailyReportTime,
		"daily_report_timezone": o.DailyReportTimezone,
		"files_enabled":         o.FilesEnabled,
		"notes_enabled":         o.NotesEnabled,
		"episode_folders":       episodeTemplatePatchLines(o.EpisodeFolders, episodeFolderCount),
		"episode_tasks":         episodeTemplatePatchLines(o.EpisodeTasks, func(t string) int { return len(ParseEpisodeTasks(t)) }),
	}
}

func episodeTemplatePatchLines(text *string, count func(string) int) any {
	if text == nil {
		return nil
	}
	return count(*text)
}

// EpisodeTemplateLines returns the trimmed, non-empty lines of an episode template, in order.
func EpisodeTemplateLines(text string) []string {
	var lines []string
	for line := range strings.SplitSeq(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// EpisodeFolder is one folder of the episode template. Empty ViewDepartments = everyone. Empty WriteDepartments
// with ReadOnly false = the viewers may change it. MirrorOf is another entry's Path.
type EpisodeFolder struct {
	Path             string   `json:"path"`
	ViewDepartments  []string `json:"view_departments,omitempty"`
	WriteDepartments []string `json:"write_departments,omitempty"`
	ReadOnly         bool     `json:"read_only,omitempty"`
	MirrorOf         string   `json:"mirror_of,omitempty"`
}

// Rules returns the folder's drive rules. Write defaults to View when only View is restricted; MirrorOf is
// not copied (it is a path here; the seeder fills in the source folder id).
func (e *EpisodeFolder) Rules() DriveRules {
	r := DriveRules{ViewDepartments: StringArray(e.ViewDepartments), WriteDepartments: StringArray(e.WriteDepartments), ReadOnly: e.ReadOnly}
	if e.ReadOnly {
		r.WriteDepartments = nil
	} else if len(r.WriteDepartments) == 0 {
		r.WriteDepartments = r.ViewDepartments
	}
	return r
}

// ParseEpisodeFolders reads the JSON list, or else the old one-path-per-line format (case-insensitive duplicate
// lines dropped, the first kept). Malformed JSON read as lines still fails validation: `"` is not a valid name.
func ParseEpisodeFolders(text string) ([]*EpisodeFolder, error) {
	if strings.HasPrefix(strings.TrimSpace(text), "[") {
		var folders []*EpisodeFolder
		if err := json.Unmarshal([]byte(text), &folders); err == nil {
			return folders, nil
		}
	}
	var folders []*EpisodeFolder
	seen := map[string]bool{}
	for _, line := range EpisodeTemplateLines(text) {
		if key := strings.ToLower(line); !seen[key] {
			seen[key] = true
			folders = append(folders, &EpisodeFolder{Path: line})
		}
	}
	return folders, nil
}

func episodeFolderCount(text string) int {
	folders, _ := ParseEpisodeFolders(text)
	return len(folders)
}

// episodePathsNested reports whether two lowercased paths are equal or one contains the other.
func episodePathsNested(a, b string) bool {
	return a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}

// isValidEpisodeFolders checks the size limits, folder names, department ids, that writers are among the viewers,
// and that a mirror points at a plain, unrelated folder and holds nothing of its own.
func isValidEpisodeFolders(text string) bool {
	if utf8.RuneCountInString(text) > TeamEpisodeFoldersMaxRunes {
		return false
	}
	folders, err := ParseEpisodeFolders(text)
	if err != nil || len(folders) > TeamEpisodeTemplateMaxLines {
		return false
	}

	byPath := make(map[string]*EpisodeFolder, len(folders))
	for _, f := range folders {
		if f == nil {
			return false
		}
		for segment := range strings.SplitSeq(f.Path, "/") {
			if !IsValidDriveItemName(segment) {
				return false
			}
		}
		key := strings.ToLower(f.Path)
		if byPath[key] != nil {
			return false
		}
		byPath[key] = f

		for _, id := range slices.Concat(f.ViewDepartments, f.WriteDepartments) {
			if !IsValidId(id) {
				return false
			}
		}
		if len(f.ViewDepartments) > 0 {
			for _, id := range f.WriteDepartments {
				if !slices.Contains(f.ViewDepartments, id) {
					return false
				}
			}
		}
	}

	for _, f := range folders {
		if f.MirrorOf == "" {
			continue
		}
		path, target := strings.ToLower(f.Path), strings.ToLower(f.MirrorOf)
		if byPath[target] == nil || byPath[target].MirrorOf != "" || episodePathsNested(path, target) || len(f.WriteDepartments) > 0 {
			return false
		}
		for other := range byPath {
			if strings.HasPrefix(other, path+"/") {
				return false
			}
		}
	}
	return true
}

type TeamForExport struct {
	Team
	SchemeName *string
}

type Invites struct {
	Invites []map[string]string `json:"invites"`
}

type TeamsWithCount struct {
	Teams      []*Team `json:"teams"`
	TotalCount int64   `json:"total_count"`
}

func (o *Invites) ToEmailList() []string {
	emailList := make([]string, 0, len(o.Invites))
	for _, invite := range o.Invites {
		emailList = append(emailList, invite["email"])
	}
	return emailList
}

func (o *Team) Etag() string {
	return Etag(o.Id, o.UpdateAt)
}

func (o *Team) IsValid() *AppError {
	if !IsValidId(o.Id) {
		return NewAppError("Team.IsValid", "model.team.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}

	if o.CreateAt == 0 {
		return NewAppError("Team.IsValid", "model.team.is_valid.create_at.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if o.UpdateAt == 0 {
		return NewAppError("Team.IsValid", "model.team.is_valid.update_at.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if len(o.Email) > TeamEmailMaxLength {
		return NewAppError("Team.IsValid", "model.team.is_valid.email.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if o.Email != "" && !IsValidEmail(o.Email) {
		return NewAppError("Team.IsValid", "model.team.is_valid.email.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if utf8.RuneCountInString(o.DisplayName) == 0 || utf8.RuneCountInString(o.DisplayName) > TeamDisplayNameMaxRunes {
		return NewAppError("Team.IsValid", "model.team.is_valid.name.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if len(o.Name) > TeamNameMaxLength {
		return NewAppError("Team.IsValid", "model.team.is_valid.url.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if len(o.Description) > TeamDescriptionMaxLength {
		return NewAppError("Team.IsValid", "model.team.is_valid.description.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if o.InviteId == "" {
		return NewAppError("Team.IsValid", "model.team.is_valid.invite_id.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if IsReservedTeamName(o.Name) {
		return NewAppError("Team.IsValid", "model.team.is_valid.reserved.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if !IsValidTeamName(o.Name) {
		return NewAppError("Team.IsValid", "model.team.is_valid.characters.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if !(o.Type == TeamOpen || o.Type == TeamInvite) {
		return NewAppError("Team.IsValid", "model.team.is_valid.type.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if len(o.CompanyName) > TeamCompanyNameMaxLength {
		return NewAppError("Team.IsValid", "model.team.is_valid.company.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if len(o.AllowedDomains) > TeamAllowedDomainsMaxLength {
		return NewAppError("Team.IsValid", "model.team.is_valid.domains.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if len(o.DailyReportTime) > 5 {
		return NewAppError("Team.IsValid", "model.team.is_valid.daily_report_time.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	if len(o.DailyReportTimezone) > 64 {
		return NewAppError("Team.IsValid", "model.team.is_valid.daily_report_timezone.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	if o.DailyReportsEnabled {
		if _, _, ok := ParseDailyReportTime(o.DailyReportTime); !ok {
			return NewAppError("Team.IsValid", "model.team.is_valid.daily_report_time.app_error", nil, "id="+o.Id, http.StatusBadRequest)
		}
		if _, err := time.LoadLocation(o.DailyReportTimezone); err != nil || o.DailyReportTimezone == "" {
			return NewAppError("Team.IsValid", "model.team.is_valid.daily_report_timezone.app_error", nil, "id="+o.Id, http.StatusBadRequest)
		}
	}

	if !isValidEpisodeFolders(o.EpisodeFolders) {
		return NewAppError("Team.IsValid", "model.team.is_valid.episode_folders.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	if !isValidEpisodeTasks(o.EpisodeTasks, o.EpisodeFolders) {
		return NewAppError("Team.IsValid", "model.team.is_valid.episode_tasks.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}

	return nil
}

func (o *Team) PreSave() {
	if o.Id == "" {
		o.Id = NewId()
	}

	o.CreateAt = GetMillis()
	o.UpdateAt = o.CreateAt

	o.Name = SanitizeUnicode(o.Name)
	o.DisplayName = SanitizeUnicode(o.DisplayName)
	o.Description = SanitizeUnicode(o.Description)
	o.CompanyName = SanitizeUnicode(o.CompanyName)

	if o.InviteId == "" {
		o.InviteId = NewId()
	}

	// Same defaults the migration gives existing teams.
	if o.DailyReportTime == "" {
		o.DailyReportTime = "18:00"
	}
	if o.DailyReportTimezone == "" {
		o.DailyReportTimezone = "Europe/Istanbul"
	}
}

func (o *Team) PreUpdate() {
	o.UpdateAt = GetMillis()
	o.Name = SanitizeUnicode(o.Name)
	o.DisplayName = SanitizeUnicode(o.DisplayName)
	o.Description = SanitizeUnicode(o.Description)
	o.CompanyName = SanitizeUnicode(o.CompanyName)
}

func IsReservedTeamName(s string) bool {
	s = strings.ToLower(s)

	for _, value := range reservedName {
		if strings.Index(s, value) == 0 {
			return true
		}
	}

	return false
}

func IsValidTeamName(s string) bool {
	if !isValidAlphaNum(s) {
		return false
	}

	if len(s) < TeamNameMinLength {
		return false
	}

	return true
}

var validTeamNameCharacter = regexp.MustCompile(`^[a-z0-9-]$`)

func CleanTeamName(s string) string {
	s = strings.ToLower(strings.Replace(s, " ", "-", -1))

	for _, value := range reservedName {
		if strings.Index(s, value) == 0 {
			s = strings.Replace(s, value, "", -1)
		}
	}

	s = strings.TrimSpace(s)

	for _, c := range s {
		char := fmt.Sprintf("%c", c)
		if !validTeamNameCharacter.MatchString(char) {
			s = strings.Replace(s, char, "", -1)
		}
	}

	s = strings.Trim(s, "-")

	if !IsValidTeamName(s) {
		s = NewId()
	}

	return s
}

func (o *Team) Sanitize() {
	o.Email = ""
	o.InviteId = ""
}

func (o *Team) Patch(patch *TeamPatch) {
	if patch.DisplayName != nil {
		o.DisplayName = *patch.DisplayName
	}

	if patch.Description != nil {
		o.Description = *patch.Description
	}

	if patch.CompanyName != nil {
		o.CompanyName = *patch.CompanyName
	}

	if patch.AllowedDomains != nil {
		o.AllowedDomains = *patch.AllowedDomains
	}

	if patch.AllowOpenInvite != nil {
		o.AllowOpenInvite = *patch.AllowOpenInvite
	}

	if patch.GroupConstrained != nil {
		o.GroupConstrained = patch.GroupConstrained
	}

	if patch.CloudLimitsArchived != nil {
		o.CloudLimitsArchived = *patch.CloudLimitsArchived
	}

	if patch.TasksEnabled != nil {
		o.TasksEnabled = *patch.TasksEnabled
	}

	if patch.RevisionsEnabled != nil {
		o.RevisionsEnabled = *patch.RevisionsEnabled
	}

	if patch.TaskApprovalEnabled != nil {
		o.TaskApprovalEnabled = *patch.TaskApprovalEnabled
	}

	if patch.CanvasEnabled != nil {
		o.CanvasEnabled = *patch.CanvasEnabled
	}

	if patch.DailyReportsEnabled != nil {
		o.DailyReportsEnabled = *patch.DailyReportsEnabled
	}

	if patch.DailyReportTime != nil {
		o.DailyReportTime = *patch.DailyReportTime
	}

	if patch.DailyReportTimezone != nil {
		o.DailyReportTimezone = *patch.DailyReportTimezone
	}

	if patch.FilesEnabled != nil {
		o.FilesEnabled = *patch.FilesEnabled
	}

	if patch.NotesEnabled != nil {
		o.NotesEnabled = *patch.NotesEnabled
	}

	if patch.EpisodeFolders != nil {
		o.EpisodeFolders = *patch.EpisodeFolders
	}

	if patch.EpisodeTasks != nil {
		o.EpisodeTasks = *patch.EpisodeTasks
	}
}

func (o *Team) IsGroupConstrained() bool {
	return o.GroupConstrained != nil && *o.GroupConstrained
}

// ShallowCopy returns a shallow copy of team.
func (o *Team) ShallowCopy() *Team {
	c := *o
	return &c
}

const episodeTaskMaxDueDays = 365

// EpisodeTask is one task of the episode template. Key names it for WaitsFor; Folder is an EpisodeFolder path.
// DueDays is a pointer so 0 (due the day the episode is created) differs from no deadline.
type EpisodeTask struct {
	Key          string   `json:"key"`
	Title        string   `json:"title"`
	DepartmentId string   `json:"department_id,omitempty"`
	AssigneeId   string   `json:"assignee_id,omitempty"`
	DueDays      *int     `json:"due_days,omitempty"`
	WaitsFor     []string `json:"waits_for,omitempty"`
	Folder       string   `json:"folder,omitempty"`
}

// ParseEpisodeTasks reads the JSON list, or else the old one-title-per-line format (keys line0, line1, ...).
func ParseEpisodeTasks(text string) []*EpisodeTask {
	if strings.HasPrefix(strings.TrimSpace(text), "[") {
		var tasks []*EpisodeTask
		if err := json.Unmarshal([]byte(text), &tasks); err == nil {
			return tasks
		}
	}
	var tasks []*EpisodeTask
	for i, line := range EpisodeTemplateLines(text) {
		tasks = append(tasks, &EpisodeTask{Key: "line" + strconv.Itoa(i), Title: line})
	}
	return tasks
}

// isValidEpisodeTasks checks the size limits, keys, titles, ids, due days, that waits-for names other entries
// without a cycle, and that a folder is a plain (non-mirror) path of the folder template.
func isValidEpisodeTasks(text, folders string) bool {
	if utf8.RuneCountInString(text) > TeamEpisodeFoldersMaxRunes {
		return false
	}
	tasks := ParseEpisodeTasks(text)
	if len(tasks) > TeamEpisodeTemplateMaxLines {
		return false
	}

	plain := map[string]bool{}
	parsed, _ := ParseEpisodeFolders(folders)
	for _, f := range parsed {
		if f != nil && f.MirrorOf == "" {
			plain[strings.ToLower(f.Path)] = true
		}
	}

	byKey := make(map[string]*EpisodeTask, len(tasks))
	for _, task := range tasks {
		if task == nil || task.Key == "" || byKey[task.Key] != nil {
			return false
		}
		byKey[task.Key] = task
		if title := strings.TrimSpace(task.Title); title == "" || utf8.RuneCountInString(title) > TaskTitleMaxRunes {
			return false
		}
		if (task.DepartmentId != "" && !IsValidId(task.DepartmentId)) || (task.AssigneeId != "" && !IsValidId(task.AssigneeId)) {
			return false
		}
		if task.DueDays != nil && (*task.DueDays < 0 || *task.DueDays > episodeTaskMaxDueDays) {
			return false
		}
		if task.Folder != "" && !plain[strings.ToLower(task.Folder)] {
			return false
		}
	}

	for _, task := range tasks {
		for i, key := range task.WaitsFor {
			if key == task.Key || byKey[key] == nil || slices.Contains(task.WaitsFor[:i], key) {
				return false
			}
		}
	}

	// Depth-first walk of waits_for: 1 = on the current path, 2 = done.
	state := map[string]int{}
	var cyclic func(key string) bool
	cyclic = func(key string) bool {
		switch state[key] {
		case 1:
			return true
		case 2:
			return false
		}
		state[key] = 1
		for _, next := range byKey[key].WaitsFor {
			if cyclic(next) {
				return true
			}
		}
		state[key] = 2
		return false
	}
	for key := range byKey {
		if cyclic(key) {
			return false
		}
	}
	return true
}
