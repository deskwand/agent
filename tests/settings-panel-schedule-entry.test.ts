import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Schedule moved out of SettingsPanel — it is now a calendar-first standalone
// view (App shell entry) with the form logic extracted into useScheduleForm.
const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const scheduleFiles = [
  path.resolve(process.cwd(), 'src/renderer/hooks/useScheduleForm.ts'),
  path.resolve(process.cwd(), 'src/renderer/components/ScheduleView.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/ScheduleCalendar.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/ScheduleToolbar.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/ScheduleEditModal.tsx'),
];
const appContent = readFileSync(appPath, 'utf8');
const scheduleContent = scheduleFiles
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('Schedule entry and form', () => {
  it('renders the schedule view from the app shell', () => {
    expect(appContent).toContain('const showSchedule = useScheduleViewState();');
    expect(appContent).toContain('showSchedule ? (');
    expect(appContent).toContain('<ScheduleView />');
  });

  it('uses schedule i18n keys', () => {
    expect(scheduleContent).toContain('t("schedule.calendarCreateTitle")');
    expect(scheduleContent).toContain('t("schedule.mode")');
  });

  it('handles null nextRunAt explicitly', () => {
    expect(scheduleContent).toContain('nextRunAt === null');
    expect(scheduleContent).toContain('t("schedule.previewAutoFind", { value: formatAppDateTime(nextRunAt) })');
  });

  it('avoids resetting schedule time when editing without changing runAt', () => {
    expect(scheduleContent).toContain('shouldResetScheduleTime');
    expect(scheduleContent).toContain('runAt !== originalRunAtInput');
  });

  it('refreshes the schedule list in the background after mount and save', () => {
    expect(scheduleContent).toContain('const loadTasks = useCallback(async () => {');
    expect(scheduleContent).toContain('useEffect(() => {\n    loadTasks();');
    expect(scheduleContent).toContain('onSaved={handleSaved}');
  });

  it('validates future run time before submit', () => {
    expect(scheduleContent).toContain('setError({ key: "schedule.futureTimeRequired" })');
    expect(scheduleContent).toContain('runAtValue <= Date.now()');
  });

  it('shows model-generated title hints and only regenerates on prompt change', () => {
    expect(scheduleContent).toContain('previewTitle');
    expect(scheduleContent).toContain('shouldRegenerateTitle');
    expect(scheduleContent).toContain('t("schedule.autoTitleCreating")');
    expect(scheduleContent).toContain('t("schedule.autoTitleEditingChanged")');
  });

  it('supports once, daily and weekly multi-slot schedule editing', () => {
    expect(scheduleContent).toContain("const [scheduleMode, setScheduleMode] = useState<ScheduleFormMode>(\"once\")");
    expect(scheduleContent).toContain('{t("schedule.mode")}');
    expect(scheduleContent).toContain('{t("schedule.weekday")}');
    expect(scheduleContent).toContain('{t("schedule.times")}');
    expect(scheduleContent).toContain('t("schedule.previewAutoFind", {');
  });

  it('keeps fixed half-hour quick slots plus editable custom time entries', () => {
    expect(scheduleContent).toContain('const TIMES_30MIN: string[]');
    expect(scheduleContent).toContain('placeholder="HH:mm"');
    expect(scheduleContent).toContain('function isValidTimeValue(value: string): boolean');
    expect(scheduleContent).toContain('t("schedule.addTime")');
  });

  it('maps daily and weekly scheduleConfig kinds when editing a task', () => {
    expect(scheduleContent).toContain('task.scheduleConfig?.kind === "weekly"');
    expect(scheduleContent).toContain('buildScheduleConfigFromForm(');
  });

  it('saves cwd in create and update payloads so backend validation can reject unsupported paths early', () => {
    expect(scheduleContent).toContain('cwd: cwd.trim() || workingDirRef.current || ""');
    expect(scheduleContent).toContain('const updated = await window.electronAPI.schedule.update(');
    expect(scheduleContent).toContain('await window.electronAPI.schedule.create(payload);');
  });
});
