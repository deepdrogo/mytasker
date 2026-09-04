// Georgian dictionary, assembled from per-feature fragments. Later fragments win on duplicate keys.
import { ai } from './ka/ai';
import { assistants } from './ka/assistants';
import { auth } from './ka/auth';
import { collab } from './ka/collab';
import { command } from './ka/command';
import { core } from './ka/core';
import { insights } from './ka/insights';
import { landing } from './ka/landing';
import { notifications } from './ka/notifications';
import { projects } from './ka/projects';
import { prompts } from './ka/prompts';
import { routines } from './ka/routines';
import { settings } from './ka/settings';
import { sharing } from './ka/sharing';
import { tasks } from './ka/tasks';

export const ka: Record<string, string> = {
  ...core,
  ...tasks,
  ...auth,
  ...landing,
  ...projects,
  ...prompts,
  ...routines,
  ...collab,
  ...ai,
  ...command,
  ...insights,
  ...notifications,
  ...sharing,
  ...settings,
  ...assistants,
};
