import type { JSX } from 'solid-js';
import { batch, createEffect, createSignal, Show } from 'solid-js';
import { ApiError } from '~/api/client';
import { Button } from '~/components/ui/Button';
import { Drawer } from '~/components/ui/Drawer';
import { ConfirmDialog } from '~/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '~/components/ui/Input';
import { projectsApi, type ProjectInput } from '~/features/projects/api';
import { toast } from '~/stores/ui';
import type { Priority, Project, ProjectKind, ProjectMode, ProjectStatus } from '~/types';
import styles from './ProjectEditor.module.css';

interface ProjectEditorProps {
  open: boolean;
  onClose: () => void;
  project?: Project | null;
  defaultKind?: ProjectKind;
  onSaved?: (project: Project) => void;
  onDeleted?: () => void;
}

const MODE_HINT: Record<ProjectMode, string> = {
  private: 'Only you. Members cannot be invited.',
  group: 'Everything in the project is shared with members.',
  group_plus: 'Shared, but each member can keep private tasks and prompts inside the project.',
};

export function ProjectEditor(props: ProjectEditorProps): JSX.Element {
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [kind, setKind] = createSignal<ProjectKind>('project');
  const [mode, setMode] = createSignal<ProjectMode>('private');
  const [status, setStatus] = createSignal<ProjectStatus>('active');
  const [priority, setPriority] = createSignal<Priority>('normal');
  const [startDate, setStartDate] = createSignal('');
  const [deadline, setDeadline] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  const isEdit = () => Boolean(props.project);

  createEffect(() => {
    if (!props.open) return;
    const p = props.project;
    batch(() => {
      setName(p?.name ?? '');
      setDescription(p?.description ?? '');
      setKind(p?.kind ?? props.defaultKind ?? 'project');
      setMode(p?.mode ?? 'private');
      setStatus(p?.status ?? 'active');
      setPriority(p?.priority ?? 'normal');
      setStartDate(p?.start_date ?? '');
      setDeadline(p?.deadline ?? '');
      setNotes(p?.notes ?? '');
      setError('');
    });
  });

  const save = async (event?: Event) => {
    event?.preventDefault();
    if (saving()) return;
    if (!name().trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError('');
    const payload: ProjectInput = {
      name: name().trim(),
      description: description(),
      kind: kind(),
      status: status(),
      priority: priority(),
      start_date: startDate() || null,
      deadline: deadline() || null,
      notes: notes(),
    };
    try {
      let saved: Project;
      if (props.project) {
        saved = await projectsApi.update(props.project.id, { ...payload, version: props.project.version });
        if (mode() !== props.project.mode) saved = await projectsApi.changeMode(saved.id, mode());
        toast('Project saved');
      } else {
        saved = await projectsApi.create({ ...payload, mode: mode() });
        toast('Project created');
      }
      props.onSaved?.(saved);
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the project.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!props.project) return;
    try {
      await projectsApi.remove(props.project.id);
      toast('Project deleted');
      props.onDeleted?.();
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the project.');
    } finally {
      setConfirmDelete(false);
    }
  };

  const canManage = () => !props.project || props.project.capabilities.manage_project;
  const isOwner = () => !props.project || props.project.role === 'owner';

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title={isEdit() ? 'Edit project' : 'New project'}
      footer={
        <div class={styles.footer}>
          <Show when={isEdit() && isOwner()}>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </Show>
          <div class={styles.footerRight}>
            <Button variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving()} disabled={!canManage()}>
              {isEdit() ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      }
    >
      <form class={styles.form} onSubmit={save}>
        <Field label="Name" required error={error()}>
          <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus disabled={!canManage()} />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description()} onInput={(e) => setDescription(e.currentTarget.value)} disabled={!canManage()} />
        </Field>

        <div class={styles.grid}>
          <Field label="Type" hint={kind() === 'active' ? 'Shown on Today and in Active Projects.' : undefined}>
            <Select value={kind()} onChange={(e) => setKind(e.currentTarget.value as ProjectKind)} disabled={!canManage()}>
              <option value="project">Project</option>
              <option value="active">Active project</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status()} onChange={(e) => setStatus(e.currentTarget.value as ProjectStatus)} disabled={!canManage()}>
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority()} onChange={(e) => setPriority(e.currentTarget.value as Priority)} disabled={!canManage()}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Collaboration" hint={MODE_HINT[mode()]}>
            <Select value={mode()} onChange={(e) => setMode(e.currentTarget.value as ProjectMode)} disabled={!isOwner()}>
              <option value="private">Private</option>
              <option value="group">Group</option>
              <option value="group_plus">Group Plus</option>
            </Select>
          </Field>
          <Field label="Start">
            <Input type="date" value={startDate()} onInput={(e) => setStartDate(e.currentTarget.value)} disabled={!canManage()} />
          </Field>
          <Field label="Deadline">
            <Input type="date" value={deadline()} onInput={(e) => setDeadline(e.currentTarget.value)} disabled={!canManage()} />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea rows={4} value={notes()} onInput={(e) => setNotes(e.currentTarget.value)} disabled={!canManage()} />
        </Field>
      </form>

      <ConfirmDialog
        open={confirmDelete()}
        title="Delete this project?"
        message="Tasks stay in your lists without a project. Prompts linked to the project remain in your library."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Drawer>
  );
}
